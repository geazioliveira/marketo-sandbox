import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// A case that waits on a child process must outlast the child's own timeout
// (#23): then a slow child is killed by that timeout and fails the case with
// its output, instead of vitest cutting the case off first. vitest.config.ts
// keeps vitest's 5 s default, which catches a hung pure test fast, so each
// spec that spawns declares its own case timeout with vi.setConfig. This
// guard reads the specs as text and checks that declaration against every
// process timeout the spec, or a test/support/ helper it imports, gives.

const root = path.resolve(__dirname, '..')

/** A process timeout or a case timeout, where it is written. */
interface Timeout {
  ms: number
  line: number
}

/** What a test/support/ export does, as its source says. */
interface Helper {
  spawns: boolean
  timeouts: Timeout[]
  file: string
}

/** The constants the specs name in place of a number, from test/support/hooks.ts. */
const namedTimeouts = (source: string): Map<string, number> =>
  new Map(
    [...source.matchAll(/^export const (\w+Timeout) = ([\d_]+)$/gm)].map(
      ([, name, value]) => [name, Number(value.replaceAll('_', ''))],
    ),
  )

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length

/** A number literal, or a constant from `names`; anything else is not a timeout. */
const resolve = (
  value: string,
  names: Map<string, number>,
): number | undefined =>
  /^[\d_]+$/.test(value) ? Number(value.replaceAll('_', '')) : names.get(value)

/**
 * Every `timeout: <value>` and `timeout = <value>` in `source` whose value is
 * a number or a named timeout. A shorthand `timeout,` passes a value set
 * elsewhere, and that assignment is what this reads.
 */
function processTimeouts(
  source: string,
  names: Map<string, number>,
): Timeout[] {
  const found: Timeout[] = []
  for (const match of source.matchAll(/\btimeout\s*[:=]\s*([\w]+)/g)) {
    const ms = resolve(match[1], names)
    if (ms !== undefined) found.push({ ms, line: lineOf(source, match.index) })
  }
  return found
}

/** A call that starts a process, in a support module or a spec. */
const spawnCall =
  /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\(/

/**
 * The exports of a test/support/ module, each with the source from its
 * `export` line to the next one. An export spawns when that source calls a
 * process API or another export of the module that spawns; its timeouts are
 * its own and those of the exports it calls.
 */
function supportHelpers(
  file: string,
  source: string,
  names: Map<string, number>,
): Map<string, Helper> {
  const starts = [
    ...source.matchAll(/^export (?:async )?(?:function|class|const) (\w+)/gm),
  ]
  const bodies = starts.map((match, index) => ({
    name: match[1],
    offset: match.index,
    body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }))
  const helpers = new Map<string, Helper>(
    bodies.map(({ name, offset, body }) => [
      name,
      {
        file,
        spawns: spawnCall.test(body),
        timeouts: processTimeouts(body, names).map((timeout) => ({
          ms: timeout.ms,
          line: timeout.line + lineOf(source, offset) - 1,
        })),
      },
    ]),
  )
  // An export that calls another one inherits what that one does.
  for (let changed = true; changed;) {
    changed = false
    for (const { name, body } of bodies) {
      const helper = helpers.get(name)!
      for (const [other, callee] of helpers) {
        if (other === name || !new RegExp(`\\b${other}\\b`).test(body)) continue
        if (callee.spawns && !helper.spawns) {
          helper.spawns = true
          changed = true
        }
        for (const timeout of callee.timeouts)
          if (!helper.timeouts.includes(timeout)) {
            helper.timeouts.push(timeout)
            changed = true
          }
      }
    }
  }
  return helpers
}

/** The names a spec imports from `test/support/<module>`, by module. */
function supportImports(source: string): Map<string, string[]> {
  const imports = new Map<string, string[]>()
  for (const [, names, module] of source.matchAll(
    /^import\s*\{([^}]*)\}\s*from\s*'(?:\.\.?\/)+support\/([\w-]+)'/gm,
  ))
    imports.set(
      module,
      names
        .split(',')
        .map((name) => name.replace(/^\s*type\s+/, '').trim())
        .filter(Boolean),
    )
  return imports
}

/** A spec imports child_process itself, statically or with import(). */
const importsChildProcess = (source: string): boolean =>
  /^import\b[^;]*?from\s*'(?:node:)?child_process'/m.test(source) ||
  /\bimport\(\s*'(?:node:)?child_process'\s*\)/.test(source)

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
 * What is wrong with one spec: nothing when it starts no process, or when it
 * declares a case timeout above every process timeout it and its helpers give.
 */
function auditSpec(
  file: string,
  source: string,
  support: Map<string, Map<string, Helper>>,
  names: Map<string, number>,
): string[] {
  const used: { name: string; helper: Helper }[] = []
  for (const [module, imported] of supportImports(source))
    for (const name of imported) {
      const helper = support.get(module)?.get(name)
      if (helper?.spawns === true) used.push({ name, helper })
    }
  if (used.length === 0 && !importsChildProcess(source)) return []
  const declared = caseTimeout(source, names)
  if (declared === undefined)
    return [
      `${file}: dispara processos (${
        used.map(({ name }) => name).join(', ') || 'node:child_process'
      }) e não declara vi.setConfig({ testTimeout }): o caso fica nos 5 s do vitest`,
    ]
  const children = [
    ...processTimeouts(source, names).map((timeout) => ({
      ...timeout,
      at: `${file}:${timeout.line}`,
    })),
    ...used.flatMap(({ name, helper }) =>
      helper.timeouts.map((timeout) => ({
        ...timeout,
        at: `${helper.file}:${timeout.line} (${name})`,
      })),
    ),
  ]
  return children
    .filter((child) => child.ms >= declared.ms)
    .map(
      (child) =>
        `${file}:${declared.line}: o caso tem ${declared.ms} ms, e o processo de ${child.at} tem ${child.ms} ms: o caso precisa esperar mais que o processo`,
    )
}

// ---------------------------------------------------------------------------
// The repository

const read = (file: string): string =>
  readFileSync(path.join(root, file), 'utf8')

const names = namedTimeouts(read('test/support/hooks.ts'))

const support = new Map(
  readdirSync(path.join(root, 'test', 'support'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const relative = path.join('test', 'support', file)
      return [
        file.replace(/\.ts$/, ''),
        supportHelpers(relative, read(relative), names),
      ] as const
    }),
)

// This file is left out: its own cases quote spawning specs as strings.
const specs = ['test', 'src']
  .flatMap((dir) =>
    readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => path.join(dir, file)),
  )
  .filter((file) => file !== path.join('test', 'test-timeouts.spec.ts'))

describe('the case timeout of a spec that starts processes (#23)', () => {
  it('reads the named timeouts and the helpers that spawn', () => {
    expect(names.get('processTimeout')).toBeGreaterThan(0)
    expect(names.get('spawnTimeout')).toBeGreaterThan(0)
    const hooks = support.get('hooks')!
    const tempRepo = support.get('temp-repo')!
    for (const name of ['spawnWith', 'runHook', 'hookRepo', 'realGit'])
      expect(hooks.get(name)?.spawns, name).toBe(true)
    expect(hooks.get('loadHookLib')?.spawns).toBe(false)
    expect(tempRepo.get('exec')?.spawns).toBe(true)
    expect(tempRepo.get('TempRepo')?.spawns).toBe(true)
    expect(tempRepo.get('projectRoot')?.spawns).toBe(false)
    expect(
      hooks.get('spawnWith')?.timeouts.map((timeout) => timeout.ms),
    ).toContain(names.get('spawnTimeout'))
  })

  it('finds the specs to read', () => {
    expect(specs).toContain(path.join('test', 'scripts', 'gate.spec.ts'))
    expect(specs).toContain(path.join('test', 'hooks', 'run-sh.spec.ts'))
    expect(specs.length).toBeGreaterThan(20)
  })

  it('holds in every spec under test/ and src/', () => {
    expect(
      specs.flatMap((file) => auditSpec(file, read(file), support, names)),
    ).toEqual([])
  })
})

describe('auditSpec', () => {
  const helpers = new Map([
    [
      'temp-repo',
      new Map<string, Helper>([
        ['exec', { file: 'temp-repo.ts', spawns: true, timeouts: [] }],
        [
          'TempRepo',
          {
            file: 'temp-repo.ts',
            spawns: true,
            timeouts: [{ ms: 60_000, line: 237 }],
          },
        ],
        ['projectRoot', { file: 'temp-repo.ts', spawns: false, timeouts: [] }],
      ]),
    ],
  ])
  const known = new Map([['processTimeout', 120_000]])
  const audit = (source: string): string[] =>
    auditSpec('x.spec.ts', source, helpers, known)

  it('leaves a spec that starts no process alone', () => {
    expect(
      audit(`import { projectRoot } from '../support/temp-repo'\n`),
    ).toEqual([])
    // A child_process call inside a string is a script for a child, not a
    // process this spec starts.
    expect(audit("const script = `require('node:child_process')`\n")).toEqual(
      [],
    )
  })

  it('asks a spec that spawns for a case timeout', () => {
    expect(audit(`import { spawnSync } from 'node:child_process'\n`)).toEqual([
      'x.spec.ts: dispara processos (node:child_process) e não declara vi.setConfig({ testTimeout }): o caso fica nos 5 s do vitest',
    ])
    expect(
      audit(`const { spawn } = await import('node:child_process')\n`),
    ).toHaveLength(1)
    expect(
      audit(
        `import {\n  exec,\n  projectRoot,\n} from '../support/temp-repo'\n`,
      ),
    ).toEqual([
      'x.spec.ts: dispara processos (exec) e não declara vi.setConfig({ testTimeout }): o caso fica nos 5 s do vitest',
    ])
  })

  it('refuses a case timeout equal to or below a process timeout', () => {
    expect(
      audit(
        [
          `import { exec } from '../support/temp-repo'`,
          `const run = exec('x', [], { timeout: 60_000 })`,
          `vi.setConfig({ testTimeout: 60_000 })`,
        ].join('\n'),
      ),
    ).toEqual([
      'x.spec.ts:3: o caso tem 60000 ms, e o processo de x.spec.ts:2 tem 60000 ms: o caso precisa esperar mais que o processo',
    ])
    // The helper's own timeout counts too, with where it is written.
    expect(
      audit(
        [
          `import { TempRepo } from '../support/temp-repo'`,
          `vi.setConfig({ testTimeout: 30_000 })`,
        ].join('\n'),
      ),
    ).toEqual([
      'x.spec.ts:2: o caso tem 30000 ms, e o processo de temp-repo.ts:237 (TempRepo) tem 60000 ms: o caso precisa esperar mais que o processo',
    ])
  })

  it('accepts a case timeout above every process timeout, by number or by name', () => {
    expect(
      audit(
        [
          `import { TempRepo } from '../support/temp-repo'`,
          `import { spawnSync } from 'node:child_process'`,
          `spawnSync('sh', [], { timeout: 30_000 })`,
          `vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })`,
        ].join('\n'),
      ),
    ).toEqual([])
  })
})
