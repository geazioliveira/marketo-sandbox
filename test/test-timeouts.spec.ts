import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// Two rules for a test that waits on a child process (#23). The process gets
// a timeout of its own: vitest's case timeout does not kill a child, and a
// blocking spawnSync keeps vitest's timer from even firing. And the case
// outlasts that timeout, so a slow child is killed first and fails the case
// with its output. vitest.config.ts keeps vitest's 5 s default, which catches
// a hung pure test fast, so each spec that spawns declares its own case
// timeout with vi.setConfig. This guard parses the specs and test/support/
// with the TypeScript compiler, so comments, strings and template literals
// read as they run, and checks both rules on every process call it finds.

const root = path.resolve(__dirname, '..')

/** A process timeout or a case timeout, where it is written. */
interface Timeout {
  ms: number
  at: string
}

/** What a test/support/ export does, as its source says. */
interface Helper {
  /** It starts a process, itself or through another export. */
  spawns: boolean
  /** A process it starts takes its timeout from the caller's options, so each call gives one. */
  needsTimeout: boolean
  /** The timeouts it gives its processes, its own and those of the exports it uses. */
  timeouts: Timeout[]
}

/** The child_process functions that start a process. */
const processApis = new Set([
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
])

const isChildProcess = (module: string): boolean =>
  /^(?:node:)?child_process$/.test(module)

// ---------------------------------------------------------------------------
// Reading the source

const parse = (file: string, source: string): ts.SourceFile =>
  ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

/** `file:line` of a node. */
const where = (node: ts.Node): string => {
  const file = node.getSourceFile()
  return `${file.fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
}

/** Every node under `node`, itself first. */
function* walk(node: ts.Node): Generator<ts.Node> {
  yield node
  const children: ts.Node[] = []
  ts.forEachChild(node, (child) => {
    children.push(child)
  })
  for (const child of children) yield* walk(child)
}

/** The constants the specs name in place of a number: `export const <x>Timeout = <n>`. */
function namedTimeouts(file: ts.SourceFile): Map<string, number> {
  const names = new Map<string, number>()
  for (const node of walk(file))
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith('Timeout') &&
      node.initializer !== undefined &&
      ts.isNumericLiteral(node.initializer)
    )
      names.set(node.name.text, Number(node.initializer.text))
  return names
}

/** What a file imports: each local name with its module, and the namespaces. */
interface Imports {
  named: Map<string, { module: string; imported: string }>
  namespaces: Map<string, string>
}

/** The module a `import(…)` or `require(…)` call loads, if it is one. */
function loadedModule(expression: ts.Expression): string | undefined {
  const call = ts.isAwaitExpression(expression)
    ? expression.expression
    : expression
  if (
    !ts.isCallExpression(call) ||
    call.arguments.length !== 1 ||
    !ts.isStringLiteral(call.arguments[0])
  )
    return undefined
  const loads =
    call.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(call.expression) && call.expression.text === 'require')
  return loads ? call.arguments[0].text : undefined
}

/**
 * What `file` imports, by static import, `await import(…)` or `require(…)`.
 * A type-only import or name starts nothing and is left out; `a as b` is
 * read under `b`; every import of a module counts.
 */
function importsOf(file: ts.SourceFile): Imports {
  const imports: Imports = { named: new Map(), namespaces: new Map() }
  for (const node of walk(file)) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause !== undefined &&
      !node.importClause.isTypeOnly
    ) {
      const module = node.moduleSpecifier.text
      const { name, namedBindings } = node.importClause
      if (name !== undefined) imports.namespaces.set(name.text, module)
      if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings))
        imports.namespaces.set(namedBindings.name.text, module)
      if (namedBindings !== undefined && ts.isNamedImports(namedBindings))
        for (const element of namedBindings.elements)
          if (!element.isTypeOnly)
            imports.named.set(element.name.text, {
              module,
              imported: (element.propertyName ?? element.name).text,
            })
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const module = loadedModule(node.initializer)
      if (module === undefined) continue
      if (ts.isIdentifier(node.name))
        imports.namespaces.set(node.name.text, module)
      else if (ts.isObjectBindingPattern(node.name))
        for (const element of node.name.elements)
          if (ts.isIdentifier(element.name))
            imports.named.set(element.name.text, {
              module,
              imported: (element.propertyName ?? element.name).getText(),
            })
    }
  }
  return imports
}

/** What a call starts: a child_process function, or a test/support/ export. */
type Target = { kind: 'api' } | { kind: 'helper'; module: string; name: string }

/**
 * The target of a call, from the callee: a name the file imports, one of
 * its own exports (`own`), or `namespace.name`. `supportOf` turns an import
 * path into a test/support/ module name.
 */
function targetOf(
  call: ts.CallExpression,
  imports: Imports,
  supportOf: (module: string) => string | undefined,
  own?: { module: string; names: Set<string> },
): Target | undefined {
  const origin = (module: string, name: string): Target | undefined => {
    if (isChildProcess(module))
      return processApis.has(name) ? { kind: 'api' } : undefined
    const support = supportOf(module)
    return support === undefined
      ? undefined
      : { kind: 'helper', module: support, name }
  }
  const callee = call.expression
  if (ts.isIdentifier(callee)) {
    const named = imports.named.get(callee.text)
    if (named !== undefined) return origin(named.module, named.imported)
    if (own?.names.has(callee.text) === true)
      return { kind: 'helper', module: own.module, name: callee.text }
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression)
  ) {
    const module = imports.namespaces.get(callee.expression.text)
    if (module !== undefined) return origin(module, callee.name.text)
  }
  return undefined
}

/**
 * The functions a node sits in, the nearest first. A closure sees its outer
 * functions' parameters: exec's spawn runs inside a `new Promise` callback.
 */
function enclosingFunctions(node: ts.Node): ts.SignatureDeclaration[] {
  const found: ts.SignatureDeclaration[] = []
  for (let parent = node.parent; parent !== undefined; parent = parent.parent)
    if (ts.isFunctionLike(parent)) found.push(parent)
  return found
}

/** A type (literal, or declared in the same file by name) with a `timeout` member. */
function hasTimeoutMember(
  type: ts.TypeNode | undefined,
  file: ts.SourceFile,
): boolean {
  if (type === undefined) return false
  if (ts.isTypeLiteralNode(type))
    return type.members.some((member) => member.name?.getText() === 'timeout')
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type))
    return type.types.some((member) => hasTimeoutMember(member, file))
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text
    for (const statement of file.statements) {
      if (ts.isInterfaceDeclaration(statement) && statement.name.text === name)
        return statement.members.some(
          (member) => member.name?.getText() === 'timeout',
        )
      if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name)
        return hasTimeoutMember(statement.type, file)
    }
  }
  return false
}

/** The value of `expression` in ms, if the guard can read it as a number. */
function valueOf(
  expression: ts.Expression,
  names: Map<string, number>,
): number | undefined {
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (!ts.isIdentifier(expression)) return undefined
  const named = names.get(expression.text)
  if (named !== undefined) return named
  // A destructured parameter with a default: `{ timeout = spawnTimeout }`.
  for (const fn of enclosingFunctions(expression))
    for (const parameter of fn.parameters)
      if (ts.isObjectBindingPattern(parameter.name))
        for (const element of parameter.name.elements)
          if (
            ts.isIdentifier(element.name) &&
            element.name.text === expression.text &&
            element.initializer !== undefined
          )
            return valueOf(element.initializer, names)
  return undefined
}

/**
 * `expression` is a parameter of a function around the call that hands the
 * caller's options on: `options` typed with a `timeout`, or a `timeout`
 * destructured from such options with no default.
 */
function delegates(
  expression: ts.Expression,
  functions: ts.SignatureDeclaration[],
): boolean {
  if (!ts.isIdentifier(expression)) return false
  const file = expression.getSourceFile()
  return functions.some((fn) =>
    fn.parameters.some((parameter) =>
      ts.isIdentifier(parameter.name)
        ? parameter.name.text === expression.text &&
          hasTimeoutMember(parameter.type, file)
        : ts.isObjectBindingPattern(parameter.name) &&
          parameter.name.elements.some(
            (element) =>
              ts.isIdentifier(element.name) &&
              element.name.text === expression.text &&
              element.initializer === undefined &&
              hasTimeoutMember(parameter.type, file),
          ),
    ),
  )
}

/** The timeout a call gives its process, as the guard reads it. */
type CallTimeout =
  | { kind: 'none' }
  | { kind: 'value'; ms: number }
  | { kind: 'unread'; text: string }
  | { kind: 'delegated' }

/**
 * The timeout in a call's arguments: a `timeout` property of an object
 * literal, or the caller's options that the call's function hands on.
 */
function timeoutOf(
  call: ts.CallExpression,
  names: Map<string, number>,
): CallTimeout {
  const fn = enclosingFunctions(call)
  let delegated = false
  for (const argument of call.arguments) {
    if (delegates(argument, fn)) delegated = true
    if (!ts.isObjectLiteralExpression(argument)) continue
    for (const property of argument.properties) {
      if (ts.isSpreadAssignment(property) && delegates(property.expression, fn))
        delegated = true
      const value = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : undefined
      if (value === undefined || property.name?.getText() !== 'timeout')
        continue
      if (delegates(value, fn)) return { kind: 'delegated' }
      const ms = valueOf(value, names)
      return ms === undefined || ms <= 0
        ? { kind: 'unread', text: value.getText() }
        : { kind: 'value', ms }
    }
  }
  return delegated ? { kind: 'delegated' } : { kind: 'none' }
}

const untimed = (call: ts.CallExpression): string =>
  `${where(call)}: ${call.expression.getText()}(…) sem timeout: o processo precisa do próprio, o do caso não o encerra`

const unread = (call: ts.CallExpression, text: string): string =>
  `${where(call)}: ${call.expression.getText()}(…) dá o timeout ${text}, que o guarda não lê como um número positivo: use um número ou um nome de test/support/hooks.ts`

// ---------------------------------------------------------------------------
// test/support/

/** A test/support/ module, by the name a spec imports it with. */
interface SupportModule {
  name: string
  file: string
  source: string
}

const supportFromSupport = (module: string): string | undefined =>
  /^\.\/([\w-]+)$/.exec(module)?.[1]

const supportFromSpec = (module: string): string | undefined =>
  /^(?:\.\.?\/)+support\/([\w-]+)$/.exec(module)?.[1]

/** The names a statement exports. */
function exportedNames(statement: ts.Statement): string[] {
  const exported = ts.canHaveModifiers(statement)
    ? (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    : false
  if (!exported) return []
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name !== undefined
  )
    return [statement.name.text]
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    )
  return []
}

/**
 * The exports of the test/support/ modules, and every process call in them
 * whose timeout is missing or unreadable. A process call whose options come
 * from the caller (temp-repo's exec spreads its `options`) is the caller's
 * to time: the export needs a timeout from every call of it.
 */
function analyzeSupport(
  modules: SupportModule[],
  names: Map<string, number>,
): { helpers: Map<string, Map<string, Helper>>; problems: string[] } {
  interface Export {
    module: string
    statement: ts.Statement
    imports: Imports
    own: Set<string>
    helper: Helper
  }
  const helpers = new Map<string, Map<string, Helper>>()
  const exports: Export[] = []
  for (const module of modules) {
    const file = parse(module.file, module.source)
    const imports = importsOf(file)
    const own = new Set(file.statements.flatMap(exportedNames))
    const byName = new Map<string, Helper>()
    helpers.set(module.name, byName)
    for (const statement of file.statements)
      for (const name of exportedNames(statement)) {
        const helper: Helper = {
          spawns: false,
          needsTimeout: false,
          timeouts: [],
        }
        byName.set(name, helper)
        exports.push({ module: module.name, statement, imports, own, helper })
      }
  }
  const helperOf = (target: Target | undefined): Helper | undefined =>
    target?.kind === 'helper'
      ? helpers.get(target.module)?.get(target.name)
      : undefined
  const callsOf = (entry: Export) =>
    [...walk(entry.statement)].filter(ts.isCallExpression).map((call) => ({
      call,
      target: targetOf(call, entry.imports, supportFromSupport, {
        module: entry.module,
        names: entry.own,
      }),
    }))
  /** The exports a statement names, by identifier or `namespace.name`. */
  const usedBy = (entry: Export): Helper[] =>
    [...walk(entry.statement)].flatMap((node) => {
      if (ts.isIdentifier(node)) {
        const named = entry.imports.named.get(node.text)
        const module =
          named === undefined ? undefined : supportFromSupport(named.module)
        const helper =
          module !== undefined
            ? helpers.get(module)?.get(named!.imported)
            : entry.own.has(node.text)
              ? helpers.get(entry.module)?.get(node.text)
              : undefined
        return helper === undefined || helper === entry.helper ? [] : [helper]
      }
      return []
    })
  const required = (target: Target | undefined): boolean =>
    target?.kind === 'api' || helperOf(target)?.needsTimeout === true
  const key = (helper: Helper): string =>
    JSON.stringify([
      helper.spawns,
      helper.needsTimeout,
      helper.timeouts.map((timeout) => `${timeout.ms}@${timeout.at}`).sort(),
    ])
  // An export's facts depend on the exports it uses: repeat until none moves.
  for (let changed = true; changed;) {
    changed = false
    for (const entry of exports) {
      const calls = callsOf(entry).filter(({ target }) => required(target))
      const timeouts = calls.map(({ call }) => ({
        call,
        timeout: timeoutOf(call, names),
      }))
      const used = usedBy(entry)
      const next: Helper = {
        spawns:
          calls.length > 0 ||
          callsOf(entry).some(({ target }) => target?.kind === 'api') ||
          used.some((other) => other.spawns),
        needsTimeout: timeouts.some(
          ({ timeout }) => timeout.kind === 'delegated',
        ),
        timeouts: [
          ...timeouts.flatMap(({ call, timeout }) =>
            timeout.kind === 'value'
              ? [{ ms: timeout.ms, at: where(call) }]
              : [],
          ),
          ...used.flatMap((other) => other.timeouts),
        ],
      }
      if (key(next) !== key(entry.helper)) {
        Object.assign(entry.helper, next)
        changed = true
      }
    }
  }
  const problems = exports.flatMap((entry) =>
    callsOf(entry)
      .filter(({ target }) => required(target))
      .flatMap(({ call }) => {
        const timeout = timeoutOf(call, names)
        if (timeout.kind === 'none') return [untimed(call)]
        if (timeout.kind === 'unread') return [unread(call, timeout.text)]
        return []
      }),
  )
  return { helpers, problems: [...new Set(problems)] }
}

// ---------------------------------------------------------------------------
// A spec

/** The case timeout a spec gives with `vi.setConfig({ testTimeout })`, if any. */
function caseTimeout(
  file: ts.SourceFile,
  names: Map<string, number>,
): (Timeout & { text: string }) | undefined {
  for (const node of walk(file)) {
    if (
      !ts.isCallExpression(node) ||
      node.expression.getText() !== 'vi.setConfig' ||
      node.arguments.length === 0 ||
      !ts.isObjectLiteralExpression(node.arguments[0])
    )
      continue
    for (const property of node.arguments[0].properties)
      if (
        ts.isPropertyAssignment(property) &&
        property.name.getText() === 'testTimeout'
      )
        return {
          ms: valueOf(property.initializer, names) ?? Number.NaN,
          at: where(node),
          text: property.initializer.getText(),
        }
  }
  return undefined
}

/**
 * What is wrong with one spec: nothing when it starts no process. Otherwise
 * every call of child_process, or of a helper that takes the timeout from
 * its caller, gives one the guard reads as a number; and the spec declares
 * a case timeout above every timeout its calls and its helpers give.
 */
function auditSpec(
  fileName: string,
  source: string,
  helpers: Map<string, Map<string, Helper>>,
  names: Map<string, number>,
): string[] {
  const file = parse(fileName, source)
  const imports = importsOf(file)
  const helperOf = (target: Target | undefined): Helper | undefined =>
    target?.kind === 'helper'
      ? helpers.get(target.module)?.get(target.name)
      : undefined
  /** The spawning helpers the spec names, by import or `namespace.name`. */
  const used = new Map<string, Helper>()
  for (const node of walk(file)) {
    let origin: { module: string; name: string } | undefined
    if (ts.isIdentifier(node) && imports.named.has(node.text)) {
      const named = imports.named.get(node.text)!
      origin = { module: named.module, name: named.imported }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      imports.namespaces.has(node.expression.text)
    )
      origin = {
        module: imports.namespaces.get(node.expression.text)!,
        name: node.name.text,
      }
    const module =
      origin === undefined ? undefined : supportFromSpec(origin.module)
    const helper =
      module === undefined ? undefined : helpers.get(module)?.get(origin!.name)
    if (helper?.spawns === true) used.set(node.getText(), helper)
  }
  const importsChildProcess = [
    ...[...imports.named.values()].map(({ module }) => module),
    ...imports.namespaces.values(),
  ].some(isChildProcess)
  if (used.size === 0 && !importsChildProcess) return []
  const problems: string[] = []
  const timeouts: Timeout[] = []
  for (const call of [...walk(file)].filter(ts.isCallExpression)) {
    const target = targetOf(call, imports, supportFromSpec)
    const helper = helperOf(target)
    if (
      target === undefined ||
      (target.kind === 'helper' && helper?.spawns !== true)
    )
      continue
    const timeout = timeoutOf(call, names)
    const required = target.kind === 'api' || helper?.needsTimeout === true
    if (timeout.kind === 'value')
      timeouts.push({ ms: timeout.ms, at: where(call) })
    else if (timeout.kind === 'unread')
      problems.push(unread(call, timeout.text))
    else if (timeout.kind === 'delegated')
      problems.push(
        `${where(call)}: ${call.expression.getText()}(…) repassa o timeout de quem a chama: num spec, dê o valor na própria chamada`,
      )
    else if (required) problems.push(untimed(call))
  }
  for (const [name, helper] of used)
    for (const timeout of helper.timeouts)
      timeouts.push({ ms: timeout.ms, at: `${timeout.at} (${name})` })
  const declared = caseTimeout(file, names)
  if (declared === undefined)
    return [
      ...problems,
      `${fileName}: dispara processos (${
        [...used.keys()].join(', ') || 'node:child_process'
      }) e não declara vi.setConfig({ testTimeout }): o caso fica nos 5 s do vitest`,
    ]
  if (Number.isNaN(declared.ms))
    return [
      ...problems,
      `${declared.at}: testTimeout ${declared.text}, que o guarda não lê: use um número ou um nome de test/support/hooks.ts`,
    ]
  return [
    ...problems,
    ...[
      ...new Map(
        timeouts.map((timeout) => [`${timeout.ms}@${timeout.at}`, timeout]),
      ).values(),
    ]
      .filter((timeout) => timeout.ms >= declared.ms)
      .map(
        (timeout) =>
          `${declared.at}: o caso tem ${declared.ms} ms, e o processo de ${timeout.at} tem ${timeout.ms} ms: o caso precisa esperar mais que o processo`,
      ),
  ]
}

// ---------------------------------------------------------------------------
// The repository

const read = (file: string): string =>
  readFileSync(path.join(root, file), 'utf8')

const names = namedTimeouts(
  parse('test/support/hooks.ts', read('test/support/hooks.ts')),
)

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

// This file is left out: its own cases hold spawning specs as strings.
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
    for (const name of [
      'spawnWith',
      'runHook',
      'hookRepo',
      'realGit',
      'HookRepo',
    ])
      expect(hooks.get(name)?.spawns, name).toBe(true)
    expect(hooks.get('loadHookLib')?.spawns).toBe(false)
    expect(tempRepo.get('exec')?.spawns).toBe(true)
    expect(tempRepo.get('TempRepo')?.spawns).toBe(true)
    expect(tempRepo.get('projectRoot')?.spawns).toBe(false)
    // exec takes its caller's timeout; spawnWith and runHook default to one.
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

// ---------------------------------------------------------------------------
// The guard's own cases, on made-up sources

const lines = (...text: string[]): string => text.join('\n')

describe('importsOf', () => {
  it('reads aliases, merges repeated imports and leaves type-only names out', () => {
    const imports = importsOf(
      parse(
        'x.ts',
        lines(
          `import { exec as run, type HookRepo } from '../support/temp-repo'`,
          `import type { TempRepo } from '../support/temp-repo'`,
          `import {\n  projectRoot,\n} from '../support/temp-repo'`,
          `import * as cp from 'node:child_process'`,
          `const { spawnSync: sync } = await import('node:child_process')`,
          `const repo = require('../support/temp-repo')`,
        ),
      ),
    )
    expect([...imports.named]).toEqual([
      ['run', { module: '../support/temp-repo', imported: 'exec' }],
      [
        'projectRoot',
        { module: '../support/temp-repo', imported: 'projectRoot' },
      ],
      ['sync', { module: 'node:child_process', imported: 'spawnSync' }],
    ])
    expect([...imports.namespaces]).toEqual([
      ['cp', 'node:child_process'],
      ['repo', '../support/temp-repo'],
    ])
  })
})

const tempRepoSource = lines(
  `import { spawn } from 'node:child_process'`,
  `export const projectRoot = '/'`,
  `export function exec(command: string, options: { timeout?: number } = {}) {`,
  `  return spawn(command, [], { ...options })`,
  `}`,
  `export class TempRepo {`,
  `  gate() { return exec('node', { timeout: 60_000 }) }`,
  `}`,
)

describe('analyzeSupport', () => {
  const analyze = (source: string) =>
    analyzeSupport([{ name: 'temp-repo', file: 'temp-repo.ts', source }], names)

  it('lets a helper take the timeout from its caller, and asks its callers for one', () => {
    const { helpers, problems } = analyze(
      lines(tempRepoSource, `export const git = () => exec('git')`),
    )
    expect(helpers.get('temp-repo')?.get('exec')?.needsTimeout).toBe(true)
    expect(helpers.get('temp-repo')?.get('TempRepo')).toEqual({
      spawns: true,
      needsTimeout: false,
      timeouts: [{ ms: 60_000, at: 'temp-repo.ts:7' }],
    })
    expect(problems).toEqual([
      'temp-repo.ts:9: exec(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
    ])
  })

  it('does not take a timeout parameter for a timeout the process gets', () => {
    // The options type has a timeout, but nothing hands it to the process.
    expect(
      analyze(
        lines(
          `import { spawn } from 'node:child_process'`,
          `export function helper(options: { timeout?: number } = {}) {`,
          '  return spawn(`x ${options.timeout}`)',
          `}`,
        ),
      ).problems,
    ).toEqual([
      'temp-repo.ts:3: spawn(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
    ])
  })

  it('refuses a helper timeout it cannot read, and a default it can', () => {
    const { helpers, problems } = analyze(
      lines(
        `import { spawn, spawnSync } from 'node:child_process'`,
        `export function slow(limit: number) {`,
        `  return spawnSync('git', [], { timeout: limit })`,
        `}`,
        `export function withDefault({ timeout = processTimeout }: { timeout?: number } = {}) {`,
        `  return spawn('git', [], { timeout })`,
        `}`,
      ),
    )
    expect(problems).toEqual([
      'temp-repo.ts:3: spawnSync(…) dá o timeout limit, que o guarda não lê como um número positivo: use um número ou um nome de test/support/hooks.ts',
    ])
    expect(helpers.get('temp-repo')?.get('withDefault')?.timeouts).toEqual([
      { ms: names.get('processTimeout'), at: 'temp-repo.ts:6' },
    ])
  })

  it('finds a process started inside a template literal, not one written in a string', () => {
    expect(
      analyze(
        lines(
          `import { spawnSync } from 'node:child_process'`,
          'export const version = () => `git ${spawnSync("git", ["--version"]).stdout}`',
          `export const script = "spawnSync('git')"`,
        ),
      ).problems,
    ).toEqual([
      'temp-repo.ts:2: spawnSync(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
    ])
  })
})

describe('auditSpec', () => {
  const helpers = analyzeSupport(
    [{ name: 'temp-repo', file: 'temp-repo.ts', source: tempRepoSource }],
    names,
  ).helpers
  const audit = (...text: string[]): string[] =>
    auditSpec('x.spec.ts', lines(...text), helpers, names)
  const noCase = (what: string): string =>
    `x.spec.ts: dispara processos (${what}) e não declara vi.setConfig({ testTimeout }): o caso fica nos 5 s do vitest`

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

  it('asks a spec that spawns for a case timeout, and only a real one', () => {
    expect(audit(`import { spawnSync } from 'node:child_process'`)).toEqual([
      noCase('node:child_process'),
    ])
    expect(
      audit(
        `import {\n  exec as run,\n  projectRoot,\n} from '../support/temp-repo'`,
        `// vi.setConfig({ testTimeout: 60_000 })`,
        `const text = 'vi.setConfig({ testTimeout: 60_000 })'`,
      ),
    ).toEqual([noCase('run')])
    // A namespace import reaches the helper as well.
    expect(
      audit(
        `import * as repo from '../support/temp-repo'`,
        `await repo.exec('git', { timeout: 30_000 })`,
      ),
    ).toEqual([noCase('repo.exec')])
  })

  it('asks every process call for a timeout of its own, one it can read', () => {
    expect(
      audit(
        `import { exec as run } from '../support/temp-repo'`,
        `import * as repo from '../support/temp-repo'`,
        `import * as cp from 'node:child_process'`,
        `const { spawnSync } = await import('node:child_process')`,
        `vi.setConfig({ testTimeout: 60_000 })`,
        `await run('git', { cwd: '/tmp', timeout: 30_000 })`,
        `await run('git', { cwd: '/tmp' })`,
        `cp.execFileSync('python3', [], { encoding: 'utf8' })`,
        `spawnSync('gh', args, { timeout: limit })`,
        `spawnSync('sh', ['-c', 'timeout 5 git status'])`,
        'const out = `${spawnSync("git", [], { timeout: 0 }).stdout}`',
        `await repo.exec('git')`,
      ),
    ).toEqual([
      'x.spec.ts:7: run(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
      'x.spec.ts:8: cp.execFileSync(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
      'x.spec.ts:9: spawnSync(…) dá o timeout limit, que o guarda não lê como um número positivo: use um número ou um nome de test/support/hooks.ts',
      'x.spec.ts:10: spawnSync(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
      'x.spec.ts:11: spawnSync(…) dá o timeout 0, que o guarda não lê como um número positivo: use um número ou um nome de test/support/hooks.ts',
      'x.spec.ts:12: repo.exec(…) sem timeout: o processo precisa do próprio, o do caso não o encerra',
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
