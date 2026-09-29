import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Two rules for a test that waits on a child process (#23). The process gets
// a timeout of its own: vitest's case timeout does not kill a child, and a
// blocking spawnSync keeps vitest's timer from even firing. And the case
// outlasts that timeout, so a slow child is killed first and fails the case
// with its output. vitest.config.ts keeps vitest's 5 s default, which catches
// a hung pure test fast, so each spec that spawns declares its own case
// timeout with vi.setConfig. This guard reads the specs and test/support/ as
// text and checks both rules on every process call it finds.

const root = path.resolve(__dirname, '..')

/** A process timeout or a case timeout, where it is written. */
interface Timeout {
  ms: number
  line: number
}

/** A call that starts a process, with the text of its arguments. */
interface Call {
  callee: string
  line: number
  args: string
}

/** What a test/support/ export does, as its source says. */
interface Helper {
  file: string
  /** It starts a process, itself or through another export. */
  spawns: boolean
  /** It hands its caller's options to the process, so each call gives the timeout. */
  needsTimeout: boolean
  /** The timeouts it gives its processes, its own and those of the exports it uses. */
  timeouts: Timeout[]
}

/** The child_process functions that start a process. */
const processApis = [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
]

/** The constants the specs name in place of a number, from test/support/hooks.ts. */
const namedTimeouts = (source: string): Map<string, number> =>
  new Map(
    [...source.matchAll(/^export const (\w+Timeout) = ([\d_]+)$/gm)].map(
      ([, name, value]) => [name, Number(value.replaceAll('_', ''))],
    ),
  )

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length

/** A number literal, or a constant from `names`; anything else is not read. */
const resolve = (
  value: string,
  names: Map<string, number>,
): number | undefined =>
  /^[\d_]+$/.test(value) ? Number(value.replaceAll('_', '')) : names.get(value)

const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------------------------------------------------------------------------
// Reading the source

/**
 * Where the string literal or the comment that opens at `start` ends (the
 * index of its last character), or -1 when none opens there. A quote inside
 * a comment, like the one in "the spec's", opens nothing.
 */
function endOfSkipped(source: string, start: number): number {
  const char = source[start]
  if (char === '/' && source[start + 1] === '/') {
    const end = source.indexOf('\n', start)
    return end < 0 ? source.length - 1 : end - 1
  }
  if (char === '/' && source[start + 1] === '*') {
    const end = source.indexOf('*/', start + 2)
    return end < 0 ? source.length - 1 : end + 1
  }
  if (!`'"\``.includes(char)) return -1
  for (let index = start + 1; index < source.length; index++)
    if (source[index] === '\\') index++
    else if (source[index] === char) return index
  return source.length - 1
}

/** `text` with every string literal and comment blanked out, same length and lines. */
function withoutStrings(text: string): string {
  let out = ''
  for (let index = 0; index < text.length; index++) {
    const end = endOfSkipped(text, index)
    if (end < 0) {
      out += text[index]
      continue
    }
    out += text.slice(index, end + 1).replace(/[^\n]/g, ' ')
    index = end
  }
  return out
}

/** The text between the parenthesis at `open` and the one that closes it. */
function argumentsAt(source: string, open: number): string {
  let depth = 0
  for (let index = open; index < source.length; index++) {
    const end = endOfSkipped(source, index)
    if (end >= 0) index = end
    else if (source[index] === '(') depth++
    else if (source[index] === ')' && --depth === 0)
      return source.slice(open + 1, index)
  }
  return source.slice(open + 1)
}

/** A name a file imports: from where, as the module exports it, and as the file calls it. */
interface Binding {
  module: string
  imported: string
  local: string
}

/** `a, b as c, type D`, or `a, b: c` when destructured; type-only names left out. */
const specifiers = (module: string, list: string, alias: RegExp): Binding[] =>
  list
    .split(',')
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier !== '' && !/^type\s/.test(specifier))
    .map((specifier) => {
      const [imported, local = imported] = specifier
        .split(alias)
        .map((part) => part.trim())
      return { module, imported, local }
    })

/**
 * What `source` imports: the named bindings, and the namespaces (`* as x`, a
 * default import, `const x = await import(…)`) by module. Every import of a
 * module counts; a type-only import or name does not.
 */
function importsOf(source: string): {
  named: Binding[]
  namespaces: { module: string; local: string }[]
} {
  const named: Binding[] = []
  const namespaces: { module: string; local: string }[] = []
  for (const [, typeOnly, clause, module] of source.matchAll(
    /^import\s+(type\s+)?([^;'"]*?)\s*from\s*'([^']+)'/gm,
  )) {
    if (typeOnly !== undefined) continue
    const list = /\{([^}]*)\}/.exec(clause)
    if (list !== null) named.push(...specifiers(module, list[1], /\s+as\s+/))
    const namespace = /\*\s*as\s+(\w+)/.exec(clause)
    if (namespace !== null) namespaces.push({ module, local: namespace[1] })
    const fallback = /^(\w+)\s*(?:,|$)/.exec(clause.trim())
    if (fallback !== null) namespaces.push({ module, local: fallback[1] })
  }
  for (const [, list, module] of source.matchAll(
    /\{([^}]*)\}\s*=\s*await\s+import\(\s*'([^']+)'\s*\)/g,
  ))
    named.push(...specifiers(module, list, /\s*:\s*/))
  for (const [, local, module] of source.matchAll(
    /\b(?:const|let|var)\s+(\w+)\s*=\s*await\s+import\(\s*'([^']+)'\s*\)/g,
  ))
    namespaces.push({ module, local })
  return { named, namespaces }
}

const isChildProcess = (module: string): boolean =>
  /^(?:node:)?child_process$/.test(module)

/** The child_process functions `source` can call, as it calls them. */
function processCallees(source: string): string[] {
  const { named, namespaces } = importsOf(source)
  return [
    ...named
      .filter(
        (binding) =>
          isChildProcess(binding.module) &&
          processApis.includes(binding.imported),
      )
      .map((binding) => binding.local),
    ...namespaces
      .filter((namespace) => isChildProcess(namespace.module))
      .flatMap((namespace) =>
        processApis.map((api) => `${namespace.local}.${api}`),
      ),
  ]
}

/**
 * Every call of `callees` in `source`, outside strings. A call through
 * another object, like `require('node:child_process').spawnSync(` in a
 * script the spec writes, is not a call of this file's binding.
 */
function callsOf(source: string, callees: string[]): Call[] {
  if (callees.length === 0) return []
  const pattern = new RegExp(
    `(?<![.\\w$])(${callees.map(escape).join('|')})\\s*\\(`,
    'g',
  )
  return [...withoutStrings(source).matchAll(pattern)].map((match) => ({
    callee: match[1],
    line: lineOf(source, match.index),
    args: argumentsAt(source, match.index + match[0].length - 1),
  }))
}

/** The call's arguments name a timeout: `timeout: <value>` or a shorthand `timeout`. */
const givesTimeout = (call: Call): boolean =>
  /\btimeout\b/.test(withoutStrings(call.args))

/** The timeouts a call's own arguments give, where they resolve. */
const timeoutsOf = (call: Call, names: Map<string, number>): Timeout[] =>
  [...withoutStrings(call.args).matchAll(/\btimeout\s*:\s*(\w+)/g)].flatMap(
    ([, value]) => {
      const ms = resolve(value, names)
      return ms === undefined ? [] : [{ ms, line: call.line }]
    },
  )

const untimed = (file: string, call: Call): string =>
  `${file}:${call.line}: ${call.callee}(…) sem timeout: o processo precisa do próprio, o do caso não o encerra`

// ---------------------------------------------------------------------------
// test/support/

/** A test/support/ module, by the name a spec imports it with. */
interface SupportModule {
  name: string
  file: string
  source: string
}

/**
 * The exports of the test/support/ modules, each read from its `export` line
 * to the next one, and every process call in them that gives no timeout.
 *
 * An export whose parameters take a `timeout`, and whose process call gives
 * none, hands its caller's options on to the process, like temp-repo's exec:
 * that call is its caller's to time, so every call of the export must give a
 * timeout, in a spec or in another export.
 */
function analyzeSupport(
  modules: SupportModule[],
  names: Map<string, number>,
): { helpers: Map<string, Map<string, Helper>>; problems: string[] } {
  interface Export {
    module: SupportModule
    offset: number
    body: string
    params: string
    helper: Helper
  }
  const helpers = new Map<string, Map<string, Helper>>()
  const exports: Export[] = []
  for (const module of modules) {
    const byName = new Map<string, Helper>()
    helpers.set(module.name, byName)
    const starts = [
      ...module.source.matchAll(
        /^export (?:async )?(function|class|const) (\w+)/gm,
      ),
    ]
    starts.forEach((match, index) => {
      const body = module.source.slice(
        match.index,
        starts[index + 1]?.index ?? module.source.length,
      )
      const open = body.indexOf('(')
      const helper: Helper = {
        file: module.file,
        spawns: false,
        needsTimeout: false,
        timeouts: [],
      }
      byName.set(match[2], helper)
      exports.push({
        module,
        offset: match.index,
        body,
        params: match[1] === 'class' || open < 0 ? '' : argumentsAt(body, open),
        helper,
      })
    })
  }
  /** Every export a module's code can name: its own, and the ones it imports. */
  const reachable = (module: SupportModule): Map<string, Helper> => {
    const found = new Map(helpers.get(module.name))
    for (const binding of importsOf(module.source).named) {
      const target = /^\.\/([\w-]+)$/.exec(binding.module)?.[1]
      const helper =
        target === undefined
          ? undefined
          : helpers.get(target)?.get(binding.imported)
      if (helper !== undefined) found.set(binding.local, helper)
    }
    return found
  }
  const reach = new Map(modules.map((module) => [module, reachable(module)]))
  const processCallsOf = (entry: Export): Call[] =>
    callsOf(entry.body, [
      ...processCallees(entry.module.source),
      ...[...reach.get(entry.module)!]
        .filter(([, helper]) => helper.needsTimeout)
        .map(([name]) => name),
    ]).map((call) => ({
      ...call,
      line: call.line + lineOf(entry.module.source, entry.offset) - 1,
    }))
  const key = (list: Timeout[]): string =>
    JSON.stringify(list.map((timeout) => [timeout.ms, timeout.line]).sort())
  // An export's facts depend on the exports it uses: repeat until none moves.
  for (let changed = true; changed;) {
    changed = false
    for (const entry of exports) {
      const calls = processCallsOf(entry)
      const used = [...reach.get(entry.module)!]
        .filter(
          ([name, other]) =>
            other !== entry.helper &&
            new RegExp(`(?<![.\\w$])${escape(name)}\\b`).test(
              withoutStrings(entry.body),
            ),
        )
        .map(([, other]) => other)
      const next: Helper = {
        file: entry.helper.file,
        needsTimeout:
          /\btimeout\b/.test(entry.params) &&
          calls.some((call) => !givesTimeout(call)),
        spawns: calls.length > 0 || used.some((other) => other.spawns),
        timeouts: [
          ...calls.flatMap((call) => timeoutsOf(call, names)),
          ...[...entry.params.matchAll(/\btimeout\s*=\s*(\w+)/g)].flatMap(
            ([, value]) => {
              const ms = resolve(value, names)
              const line = lineOf(entry.module.source, entry.offset)
              return ms === undefined ? [] : [{ ms, line }]
            },
          ),
          ...used.flatMap((other) => other.timeouts),
        ],
      }
      if (
        next.needsTimeout !== entry.helper.needsTimeout ||
        next.spawns !== entry.helper.spawns ||
        key(next.timeouts) !== key(entry.helper.timeouts)
      ) {
        Object.assign(entry.helper, next)
        changed = true
      }
    }
  }
  const problems = exports
    .filter((entry) => !entry.helper.needsTimeout)
    .flatMap((entry) =>
      processCallsOf(entry)
        .filter((call) => !givesTimeout(call))
        .map((call) => untimed(entry.module.file, call)),
    )
  return { helpers, problems }
}

// ---------------------------------------------------------------------------
// A spec

/** The case timeout a spec gives with vi.setConfig, if any. */
function caseTimeout(
  source: string,
  names: Map<string, number>,
): Timeout | undefined {
  const match = /\bvi\.setConfig\(\{[^}]*\btestTimeout:\s*(\w+)/.exec(source)
  if (match === null) return undefined
  const ms = resolve(match[1], names)
  return ms === undefined
    ? undefined
    : { ms, line: lineOf(source, match.index) }
}

/**
 * What is wrong with one spec: nothing when it starts no process. Otherwise
 * every call of child_process, or of a helper that leaves the timeout to its
 * caller, gives a timeout the guard can read; and the spec declares a case
 * timeout above every timeout its calls and its helpers give.
 */
function auditSpec(
  file: string,
  source: string,
  helpers: Map<string, Map<string, Helper>>,
  names: Map<string, number>,
): string[] {
  const imports = importsOf(source)
  const used = imports.named.flatMap((binding) => {
    const module = /^(?:\.\.?\/)+support\/([\w-]+)$/.exec(binding.module)?.[1]
    const helper =
      module === undefined
        ? undefined
        : helpers.get(module)?.get(binding.imported)
    return helper?.spawns === true ? [{ local: binding.local, helper }] : []
  })
  const importsChildProcess = [...imports.named, ...imports.namespaces].some(
    (binding) => isChildProcess(binding.module),
  )
  if (used.length === 0 && !importsChildProcess) return []
  const direct = processCallees(source)
  const wrappers = used
    .filter(({ helper }) => helper.needsTimeout)
    .map(({ local }) => local)
  const calls = callsOf(source, [...direct, ...used.map(({ local }) => local)])
  const problems = calls
    .filter(
      (call) => direct.includes(call.callee) || wrappers.includes(call.callee),
    )
    .flatMap((call) =>
      !givesTimeout(call)
        ? [untimed(file, call)]
        : timeoutsOf(call, names).length === 0
          ? [
              `${file}:${call.line}: ${call.callee}(…) dá um timeout que o guarda não lê: use um número ou um nome de test/support/hooks.ts`,
            ]
          : [],
    )
  const declared = caseTimeout(source, names)
  if (declared === undefined)
    return [
      ...problems,
      `${file}: dispara processos (${
        [...new Set(used.map(({ local }) => local))].join(', ') ||
        'node:child_process'
      }) e não declara vi.setConfig({ testTimeout }): o caso fica nos 5 s do vitest`,
    ]
  const children = [
    ...calls.flatMap((call) =>
      timeoutsOf(call, names).map((timeout) => ({
        ...timeout,
        at: `${file}:${timeout.line}`,
      })),
    ),
    ...used.flatMap(({ local, helper }) =>
      helper.timeouts.map((timeout) => ({
        ...timeout,
        at: `${helper.file}:${timeout.line} (${local})`,
      })),
    ),
  ]
  return [
    ...problems,
    ...children
      .filter((child) => child.ms >= declared.ms)
      .map(
        (child) =>
          `${file}:${declared.line}: o caso tem ${declared.ms} ms, e o processo de ${child.at} tem ${child.ms} ms: o caso precisa esperar mais que o processo`,
      ),
  ]
}

// ---------------------------------------------------------------------------
// The repository

const read = (file: string): string =>
  readFileSync(path.join(root, file), 'utf8')

const names = namedTimeouts(read('test/support/hooks.ts'))

const support = analyzeSupport(
  readdirSync(path.join(root, 'test', 'support'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const relative = path.join('test', 'support', file)
      return {
        name: file.replace(/\.ts$/, ''),
        file: relative,
        source: read(relative),
      }
    }),
  names,
)

// This file is left out: its own cases quote spawning specs as strings.
const specs = ['test', 'src']
  .flatMap((dir) =>
    readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => path.join(dir, file)),
  )
  .filter((file) => file !== path.join('test', 'test-timeouts.spec.ts'))

describe('the timeouts of a test that starts processes (#23)', () => {
  it('reads the named timeouts and the helpers that spawn', () => {
    expect(names.get('processTimeout')).toBeGreaterThan(0)
    expect(names.get('spawnTimeout')).toBeGreaterThan(0)
    const hooks = support.helpers.get('hooks')!
    const tempRepo = support.helpers.get('temp-repo')!
    for (const name of ['spawnWith', 'runHook', 'hookRepo', 'realGit'])
      expect(hooks.get(name)?.spawns, name).toBe(true)
    expect(hooks.get('loadHookLib')?.spawns).toBe(false)
    expect(tempRepo.get('exec')?.spawns).toBe(true)
    expect(tempRepo.get('TempRepo')?.spawns).toBe(true)
    expect(tempRepo.get('projectRoot')?.spawns).toBe(false)
    // exec hands its caller's timeout on; spawnWith and runHook give one.
    expect(tempRepo.get('exec')?.needsTimeout).toBe(true)
    expect(hooks.get('spawnWith')?.needsTimeout).toBe(false)
    expect(hooks.get('runHook')?.needsTimeout).toBe(false)
    expect(
      hooks.get('spawnWith')?.timeouts.map((timeout) => timeout.ms),
    ).toContain(names.get('spawnTimeout'))
  })

  it('finds the specs to read', () => {
    expect(specs).toContain(path.join('test', 'scripts', 'gate.spec.ts'))
    expect(specs).toContain(path.join('test', 'hooks', 'run-sh.spec.ts'))
    expect(specs.length).toBeGreaterThan(20)
  })

  it('gives every process in test/support/ a timeout of its own', () => {
    expect(support.problems).toEqual([])
  })

  it('holds in every spec under test/ and src/', () => {
    expect(
      specs.flatMap((file) =>
        auditSpec(file, read(file), support.helpers, names),
      ),
    ).toEqual([])
  })
})

describe('importsOf', () => {
  it('reads aliases, merges repeated imports and leaves type-only names out', () => {
    const { named, namespaces } = importsOf(
      [
        `import { exec as run, type HookRepo } from '../support/temp-repo'`,
        `import type { TempRepo } from '../support/temp-repo'`,
        `import {\n  projectRoot,\n} from '../support/temp-repo'`,
        `import * as cp from 'node:child_process'`,
        `const { spawnSync: sync } = await import('node:child_process')`,
      ].join('\n'),
    )
    expect(named).toEqual([
      { module: '../support/temp-repo', imported: 'exec', local: 'run' },
      {
        module: '../support/temp-repo',
        imported: 'projectRoot',
        local: 'projectRoot',
      },
      { module: 'node:child_process', imported: 'spawnSync', local: 'sync' },
    ])
    expect(namespaces).toEqual([{ module: 'node:child_process', local: 'cp' }])
  })
})

describe('analyzeSupport', () => {
  const analyze = (source: string) =>
    analyzeSupport([{ name: 'temp-repo', file: 'temp-repo.ts', source }], names)

  it('lets a wrapper hand the timeout to its caller, and asks its callers for it', () => {
    const { helpers, problems } = analyze(
      [
        `import { spawn } from 'node:child_process'`,
        `export function exec(command: string, options: { timeout?: number } = {}) {`,
        `  return spawn(command, [], { ...options })`,
        `}`,
        `export class TempRepo {`,
        `  git() { return exec('git') }`,
        `  gate() { return exec('node', { timeout: 60_000 }) }`,
        `}`,
      ].join('\n'),
    )
    expect(helpers.get('temp-repo')?.get('exec')?.needsTimeout).toBe(true)
    expect(helpers.get('temp-repo')?.get('TempRepo')).toMatchObject({
      spawns: true,
      needsTimeout: false,
      timeouts: [{ ms: 60_000, line: 7 }],
    })
    expect(problems).toEqual([
      'temp-repo.ts:6: exec(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
    ])
  })

  it('flags a process that a helper starts with no timeout', () => {
    expect(
      analyze(
        [
          `import { spawnSync } from 'node:child_process'`,
          `export function realGit(): string {`,
          `  return spawnSync('sh', ['-c', 'command -v git']).stdout`,
          `}`,
        ].join('\n'),
      ).problems,
    ).toEqual([
      'temp-repo.ts:3: spawnSync(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
    ])
  })
})

describe('auditSpec', () => {
  const helpers = analyzeSupport(
    [
      {
        name: 'temp-repo',
        file: 'temp-repo.ts',
        source: [
          `import { spawn } from 'node:child_process'`,
          `export const projectRoot = '/'`,
          `export function exec(command: string, options: { timeout?: number } = {}) {`,
          `  return spawn(command, [], { ...options })`,
          `}`,
          `export class TempRepo {`,
          `  gate() { return exec('node', { timeout: 60_000 }) }`,
          `}`,
        ].join('\n'),
      },
    ],
    names,
  ).helpers
  const audit = (...lines: string[]): string[] =>
    auditSpec('x.spec.ts', lines.join('\n'), helpers, names)

  it('leaves a spec that starts no process alone', () => {
    expect(audit(`import { projectRoot } from '../support/temp-repo'`)).toEqual(
      [],
    )
    // A child_process call inside a string is a script for a child, not a
    // process this spec starts; a type-only import starts nothing either.
    expect(audit("const script = `require('node:child_process')`")).toEqual([])
    expect(
      audit(`import type { TempRepo } from '../support/temp-repo'`),
    ).toEqual([])
  })

  it('asks a spec that spawns for a case timeout', () => {
    expect(audit(`import { spawnSync } from 'node:child_process'`)).toEqual([
      'x.spec.ts: dispara processos (node:child_process) e não declara vi.setConfig({ testTimeout }): o caso fica nos 5 s do vitest',
    ])
    expect(
      audit(
        `import {\n  exec as run,\n  projectRoot,\n} from '../support/temp-repo'`,
      ),
    ).toEqual([
      'x.spec.ts: dispara processos (run) e não declara vi.setConfig({ testTimeout }): o caso fica nos 5 s do vitest',
    ])
  })

  it('asks every process call for a timeout of its own, one it can read', () => {
    expect(
      audit(
        `import { exec as run } from '../support/temp-repo'`,
        `import * as cp from 'node:child_process'`,
        `const { spawnSync } = await import('node:child_process')`,
        `vi.setConfig({ testTimeout: 60_000 })`,
        `await run('git', { cwd: '/tmp', timeout: 30_000 })`,
        `await run('git', { cwd: '/tmp' })`,
        `cp.execFileSync('python3', [], { encoding: 'utf8' })`,
        `spawnSync('gh', args, { timeout: limit })`,
        `// 'timeout' in a string does not count:`,
        `spawnSync('sh', ['-c', 'timeout 5 git status'])`,
      ),
    ).toEqual([
      'x.spec.ts:6: run(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
      'x.spec.ts:7: cp.execFileSync(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
      'x.spec.ts:8: spawnSync(…) dá um timeout que o guarda não lê: use um número ou um nome de test/support/hooks.ts',
      'x.spec.ts:10: spawnSync(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
    ])
  })

  it('refuses a case timeout equal to or below a process timeout', () => {
    expect(
      audit(
        `import { exec } from '../support/temp-repo'`,
        `const run = exec('x', { timeout: 60_000 })`,
        `vi.setConfig({ testTimeout: 60_000 })`,
      ),
    ).toEqual([
      'x.spec.ts:3: o caso tem 60000 ms, e o processo de x.spec.ts:2 tem 60000 ms: o caso precisa esperar mais que o processo',
    ])
    // A helper's own timeout counts too, with where it is written, and an
    // aliased import is read by the name it is exported with.
    expect(
      audit(
        `import { TempRepo as Repo } from '../support/temp-repo'`,
        `vi.setConfig({ testTimeout: 30_000 })`,
      ),
    ).toEqual([
      'x.spec.ts:2: o caso tem 30000 ms, e o processo de temp-repo.ts:7 (Repo) tem 60000 ms: o caso precisa esperar mais que o processo',
    ])
  })

  it('accepts a case timeout above every process timeout, by number or by name', () => {
    expect(
      audit(
        `import { TempRepo } from '../support/temp-repo'`,
        `import { spawnSync } from 'node:child_process'`,
        `spawnSync('sh', [], { timeout: spawnTimeout })`,
        `vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })`,
      ),
    ).toEqual([])
  })
})
