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
// What it cannot follow, a process function used other than by a direct
// call, it refuses.

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
  /** The position of its parameter typed with a `timeout`, where a call gives one. */
  optionsAt?: number
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
    /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS,
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

/** `expression` without the parentheses and the `await` around it. */
function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAwaitExpression(expression)
  )
    expression = expression.expression
  return expression
}

/** The outermost parentheses or `await` around `node`, or `node` itself. */
function wrapped(node: ts.Node): ts.Node {
  while (
    ts.isParenthesizedExpression(node.parent) ||
    ts.isAwaitExpression(node.parent)
  )
    node = node.parent
  return node
}

/** The constants the specs name in place of a number: `export const <x>Timeout = <n>`. */
function namedTimeouts(file: ts.SourceFile): Map<string, number> {
  const names = new Map<string, number>()
  for (const statement of file.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text.endsWith('Timeout') &&
          declaration.initializer !== undefined &&
          ts.isNumericLiteral(declaration.initializer)
        )
          names.set(declaration.name.text, Number(declaration.initializer.text))
  return names
}

/** What a file imports: each local name with its module, and the namespaces. */
interface Imports {
  named: Map<string, { module: string; imported: string }>
  namespaces: Map<string, string>
}

/** The module a `import(…)` or `require(…)` call loads, if it is one. */
function loadedModule(expression: ts.Expression): string | undefined {
  const call = unwrap(expression)
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
 * What `file` imports, by static import, `await import(…)` or `require(…)`
 * into a name. A type-only import or name starts nothing and is left out;
 * `a as b` is read under `b`; every import of a module counts.
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

/** How a file's names resolve. */
interface Scope {
  imports: Imports
  /** The test/support/ module an import path names, if it names one. */
  supportOf: (module: string) => string | undefined
  /** In a test/support/ module: its name and its own exports. */
  own?: { module: string; names: Set<string> }
  /** test/support/hooks.ts's named timeouts, by the name it exports. */
  names: Map<string, number>
}

/** What an expression names: a child_process function, or a test/support/ export. */
type Target = { kind: 'api' } | { kind: 'helper'; module: string; name: string }

/** A name that declares or labels something here, not one that uses a binding. */
function declares(node: ts.Identifier): boolean {
  const parent = node.parent
  return (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ((ts.isBindingElement(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
  )
}

/**
 * What an expression names: an imported name, one of the module's own
 * exports, or `receiver.name` where the receiver is a namespace or a loaded
 * module (`require('node:child_process').spawnSync`).
 */
function targetOf(expression: ts.Node, scope: Scope): Target | undefined {
  const origin = (module: string, name: string): Target | undefined => {
    if (isChildProcess(module))
      return processApis.has(name) ? { kind: 'api' } : undefined
    const support = scope.supportOf(module)
    return support === undefined
      ? undefined
      : { kind: 'helper', module: support, name }
  }
  if (ts.isIdentifier(expression) && !declares(expression)) {
    const named = scope.imports.named.get(expression.text)
    if (named !== undefined) return origin(named.module, named.imported)
    if (scope.own?.names.has(expression.text) === true)
      return { kind: 'helper', module: scope.own.module, name: expression.text }
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = unwrap(expression.expression)
    const module = ts.isIdentifier(receiver)
      ? scope.imports.namespaces.get(receiver.text)
      : loadedModule(receiver)
    if (module !== undefined) return origin(module, expression.name.text)
  }
  return undefined
}

/** `node` is the callee of a call, not a value passed around. */
const calledDirectly = (node: ts.Node): boolean =>
  ts.isCallExpression(wrapped(node).parent) &&
  (wrapped(node).parent as ts.CallExpression).expression === wrapped(node)

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

const declarationCache = new WeakMap<
  ts.SourceFile,
  Map<string, ts.VariableDeclaration[]>
>()

/** The variables a file declares under `name`, at any depth. */
function declarationsOf(
  file: ts.SourceFile,
  name: string,
): ts.VariableDeclaration[] {
  let byName = declarationCache.get(file)
  if (byName === undefined) {
    byName = new Map()
    for (const node of walk(file))
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
        byName.set(node.name.text, [
          ...(byName.get(node.name.text) ?? []),
          node,
        ])
    declarationCache.set(file, byName)
  }
  return byName.get(name) ?? []
}

/**
 * The value of `expression` in ms, if the guard can read it as a number. A
 * name resolves where it is bound: a parameter of a function around it (its
 * default, if it has one), a declaration in the file, or an import of
 * test/support/hooks.ts's named timeouts. A local `processTimeout` is the
 * local one, not hooks.ts's.
 */
function valueOf(
  expression: ts.Expression,
  scope: Scope,
  seen: Set<string> = new Set(),
): number | undefined {
  expression = unwrap(expression)
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (!ts.isIdentifier(expression) || seen.has(expression.text))
    return undefined
  const name = expression.text
  const next = new Set([...seen, name])
  for (const fn of enclosingFunctions(expression))
    for (const parameter of fn.parameters) {
      const bound = ts.isIdentifier(parameter.name)
        ? parameter.name.text === name
          ? parameter
          : undefined
        : ts.isObjectBindingPattern(parameter.name)
          ? parameter.name.elements.find(
              (element) =>
                ts.isIdentifier(element.name) && element.name.text === name,
            )
          : undefined
      if (bound !== undefined)
        return bound.initializer === undefined
          ? undefined
          : valueOf(bound.initializer, scope, next)
    }
  const declarations = declarationsOf(expression.getSourceFile(), name)
  if (declarations.length > 0)
    return declarations.length === 1 &&
      declarations[0].initializer !== undefined
      ? valueOf(declarations[0].initializer, scope, next)
      : undefined
  const named = scope.imports.named.get(name)
  return named !== undefined && scope.supportOf(named.module) === 'hooks'
    ? scope.names.get(named.imported)
    : undefined
}

/**
 * `expression` is a parameter of a function around the call that hands the
 * caller's options on: `options` typed with a `timeout`, its
 * `options.timeout`, or a `timeout` destructured from such options with no
 * default.
 */
function delegates(
  expression: ts.Expression,
  functions: ts.SignatureDeclaration[],
): boolean {
  expression = unwrap(expression)
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'timeout'
  )
    expression = unwrap(expression.expression)
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
 * The timeout in a call's arguments, read in order as the object is built: a
 * `timeout` property, or a spread that comes after it and may replace it.
 * A spread of the caller's options (a parameter typed with a `timeout`)
 * hands the timeout to the caller; a spread the guard cannot see into makes
 * it unreadable.
 */
function timeoutOf(
  call: ts.CallExpression,
  scope: Scope,
  target: Target | undefined,
  helperOf: (target: Target | undefined) => Helper | undefined,
): CallTimeout {
  const functions = enclosingFunctions(call)
  let timeout: CallTimeout = { kind: 'none' }
  const read = (object: ts.ObjectLiteralExpression): void => {
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = unwrap(property.expression)
        if (ts.isObjectLiteralExpression(spread)) read(spread)
        else if (delegates(spread, functions)) timeout = { kind: 'delegated' }
        else timeout = { kind: 'unread', text: `...${spread.getText()}` }
        continue
      }
      const value = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : undefined
      if (value === undefined || property.name?.getText() !== 'timeout')
        continue
      if (delegates(value, functions)) {
        timeout = { kind: 'delegated' }
        continue
      }
      const ms = valueOf(value, scope)
      timeout =
        ms === undefined || !(ms > 0)
          ? { kind: 'unread', text: value.getText() }
          : { kind: 'value', ms }
    }
  }
  // Any object handed to a child_process function is its options; a helper
  // takes them at its parameter typed with a `timeout`, and only there (a
  // hook's input, say, is not options).
  const optionsAt = helperOf(target)?.optionsAt
  const options =
    target?.kind === 'api'
      ? call.arguments
      : optionsAt === undefined
        ? []
        : call.arguments.slice(optionsAt, optionsAt + 1)
  for (const argument of options) {
    const value = unwrap(argument)
    if (ts.isObjectLiteralExpression(value)) read(value)
    else if (delegates(value, functions)) timeout = { kind: 'delegated' }
  }
  return timeout
}

const untimed = (call: ts.CallExpression): string =>
  `${where(call)}: ${call.expression.getText()}(…) sem timeout: o processo precisa do próprio, o do caso não o encerra`

const unread = (call: ts.CallExpression, text: string): string =>
  `${where(call)}: ${call.expression.getText()}(…) dá o timeout ${text}, que o guarda não lê como um número positivo: use um número ou um nome importado de test/support/hooks.ts`

/**
 * Every place `root` uses a process function (a child_process one, or a
 * helper that `required` says needs its caller's timeout) other than by a
 * direct call: an alias, `.call`, a callback, a namespace or a loaded module
 * passed around. The guard cannot follow the process from there.
 */
function indirectUses(
  root: ts.Node,
  scope: Scope,
  required: (target: Target | undefined) => boolean,
): string[] {
  const problems: string[] = []
  const refuse = (node: ts.Node, what: string): void => {
    problems.push(
      `${where(node)}: ${what} fora de uma chamada direta: o guarda não segue o processo; chame a função pelo nome`,
    )
  }
  for (const node of walk(root)) {
    if (
      (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) &&
      required(targetOf(node, scope)) &&
      !calledDirectly(node)
    )
      refuse(node, node.getText())
    if (ts.isIdentifier(node) && !declares(node)) {
      const module = scope.imports.namespaces.get(node.text)
      const parent = wrapped(node).parent
      if (
        module !== undefined &&
        (isChildProcess(module) || scope.supportOf(module) !== undefined) &&
        !(
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === wrapped(node)
        )
      )
        refuse(node, node.text)
    }
    if (ts.isCallExpression(node)) {
      const module = loadedModule(node)
      const parent = wrapped(node).parent
      if (
        module !== undefined &&
        (isChildProcess(module) || scope.supportOf(module) !== undefined) &&
        !ts.isVariableDeclaration(parent) &&
        !(
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === wrapped(node)
        )
      )
        refuse(node, node.getText())
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// test/support/

/** A test/support/ module, by the name a spec imports it with. */
interface SupportModule {
  name: string
  file: string
  source: string
}

/** A module file of test/support/, TypeScript or JavaScript. */
const supportFile = /\.(?:[cm]?[jt]s)$/

const supportFromSupport = (module: string): string | undefined =>
  /^\.\/([\w-]+)(?:\.[cm]?[jt]s)?$/.exec(module)?.[1]

const supportFromSpec = (module: string): string | undefined =>
  /^(?:\.\.?\/)+support\/([\w-]+)(?:\.[cm]?[jt]s)?$/.exec(module)?.[1]

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

/** The position of an exported function's parameter typed with a `timeout`. */
function optionsIndex(
  statement: ts.Statement,
  name: string,
): number | undefined {
  const fn = ts.isFunctionDeclaration(statement)
    ? statement
    : ts.isVariableStatement(statement)
      ? statement.declarationList.declarations
          .filter(
            (declaration) =>
              ts.isIdentifier(declaration.name) &&
              declaration.name.text === name,
          )
          .map((declaration) => declaration.initializer)
          .find(
            (initializer) =>
              initializer !== undefined &&
              (ts.isArrowFunction(initializer) ||
                ts.isFunctionExpression(initializer)),
          )
      : undefined
  if (fn === undefined || !ts.isFunctionLike(fn)) return undefined
  const index = fn.parameters.findIndex((parameter) =>
    hasTimeoutMember(parameter.type, statement.getSourceFile()),
  )
  return index < 0 ? undefined : index
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
    statement: ts.Statement
    scope: Scope
    helper: Helper
  }
  const helpers = new Map<string, Map<string, Helper>>()
  const exports: Export[] = []
  const files: { file: ts.SourceFile; scope: Scope }[] = []
  for (const module of modules) {
    const file = parse(module.file, module.source)
    const scope: Scope = {
      imports: importsOf(file),
      supportOf: supportFromSupport,
      own: {
        module: module.name,
        names: new Set(file.statements.flatMap(exportedNames)),
      },
      names,
    }
    files.push({ file, scope })
    const byName = new Map<string, Helper>()
    helpers.set(module.name, byName)
    for (const statement of file.statements)
      for (const name of exportedNames(statement)) {
        const helper: Helper = {
          spawns: false,
          needsTimeout: false,
          timeouts: [],
          optionsAt: optionsIndex(statement, name),
        }
        byName.set(name, helper)
        exports.push({ statement, scope, helper })
      }
  }
  const helperOf = (target: Target | undefined): Helper | undefined =>
    target?.kind === 'helper'
      ? helpers.get(target.module)?.get(target.name)
      : undefined
  const required = (target: Target | undefined): boolean =>
    target?.kind === 'api' || helperOf(target)?.needsTimeout === true
  /**
   * Every call that starts a process, with the timeout it gives: a call of a
   * helper with a timeout of its own can still give a longer one.
   */
  const processCalls = (entry: Export) =>
    [...walk(entry.statement)].filter(ts.isCallExpression).flatMap((call) => {
      const target = targetOf(call.expression, entry.scope)
      if (target?.kind !== 'api' && helperOf(target)?.spawns !== true) return []
      return [
        {
          call,
          required: required(target),
          timeout: timeoutOf(call, entry.scope, target, helperOf),
        },
      ]
    })
  /** Timeouts once each, however many paths lead to them. */
  const distinct = (timeouts: Timeout[]): Timeout[] => [
    ...new Map(
      timeouts.map((timeout) => [`${timeout.ms}@${timeout.at}`, timeout]),
    ).values(),
  ]
  /** The other exports a statement names, by name, namespace or loaded module. */
  const usedBy = (entry: Export): Helper[] =>
    [...walk(entry.statement)].flatMap((node) => {
      const helper = helperOf(targetOf(node, entry.scope))
      return helper === undefined || helper === entry.helper ? [] : [helper]
    })
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
      const calls = processCalls(entry)
      const used = usedBy(entry)
      const next: Helper = {
        spawns:
          [...walk(entry.statement)].some(
            (node) => targetOf(node, entry.scope)?.kind === 'api',
          ) || used.some((other) => other.spawns),
        // Handing the caller's timeout to a helper with a default of its own
        // leaves the default when the caller gives none: only a callee
        // with no timeout of its own makes the caller's required.
        needsTimeout: calls.some(
          ({ required, timeout }) => required && timeout.kind === 'delegated',
        ),
        timeouts: distinct([
          ...calls.flatMap(({ call, timeout }) =>
            timeout.kind === 'value'
              ? [{ ms: timeout.ms, at: where(call) }]
              : [],
          ),
          ...used.flatMap((other) => other.timeouts),
        ]),
      }
      if (key(next) !== key(entry.helper)) {
        Object.assign(entry.helper, next)
        changed = true
      }
    }
  }
  const problems = [
    ...exports.flatMap((entry) =>
      processCalls(entry).flatMap(({ call, required, timeout }) => {
        if (timeout.kind === 'none' && required) return [untimed(call)]
        if (timeout.kind === 'unread') return [unread(call, timeout.text)]
        return []
      }),
    ),
    ...files.flatMap(({ file, scope }) => indirectUses(file, scope, required)),
  ]
  return { helpers, problems: [...new Set(problems)] }
}

// ---------------------------------------------------------------------------
// A spec

/**
 * The case timeout a spec gives with `vi.setConfig({ testTimeout })` as a
 * statement of the file itself: one inside a function may never run. The
 * last one wins, as it does in vitest.
 */
function caseTimeout(
  file: ts.SourceFile,
  scope: Scope,
): (Timeout & { text: string }) | undefined {
  let found: (Timeout & { text: string }) | undefined
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement)) continue
    const call = statement.expression
    if (
      !ts.isCallExpression(call) ||
      call.expression.getText() !== 'vi.setConfig' ||
      call.arguments.length === 0 ||
      !ts.isObjectLiteralExpression(call.arguments[0])
    )
      continue
    for (const property of call.arguments[0].properties)
      if (
        ts.isPropertyAssignment(property) &&
        property.name.getText() === 'testTimeout'
      )
        found = {
          ms: valueOf(property.initializer, scope) ?? Number.NaN,
          at: where(call),
          text: property.initializer.getText(),
        }
  }
  return found
}

/**
 * What is wrong with one spec: nothing when it starts no process. Otherwise
 * every call of child_process, or of a helper that takes the timeout from
 * its caller, gives one the guard reads as a number; no process function is
 * used other than by a direct call; and the spec declares a case timeout
 * above every timeout its calls and its helpers give.
 */
function auditSpec(
  fileName: string,
  source: string,
  helpers: Map<string, Map<string, Helper>>,
  names: Map<string, number>,
): string[] {
  const file = parse(fileName, source)
  const scope: Scope = {
    imports: importsOf(file),
    supportOf: supportFromSpec,
    names,
  }
  const helperOf = (target: Target | undefined): Helper | undefined =>
    target?.kind === 'helper'
      ? helpers.get(target.module)?.get(target.name)
      : undefined
  const required = (target: Target | undefined): boolean =>
    target?.kind === 'api' || helperOf(target)?.needsTimeout === true
  /** The spawning helpers the spec names, and whether it names child_process. */
  const used = new Map<string, Helper>()
  let startsProcesses = [
    ...[...scope.imports.named.values()].map(({ module }) => module),
    ...scope.imports.namespaces.values(),
  ].some(isChildProcess)
  for (const node of walk(file)) {
    const target = targetOf(node, scope)
    const helper = helperOf(target)
    if (target?.kind === 'api') startsProcesses = true
    if (helper?.spawns === true) used.set(node.getText(), helper)
  }
  if (used.size === 0 && !startsProcesses) return []
  const problems: string[] = []
  const timeouts: Timeout[] = []
  for (const call of [...walk(file)].filter(ts.isCallExpression)) {
    const target = targetOf(call.expression, scope)
    if (
      target === undefined ||
      (target.kind === 'helper' && helperOf(target)?.spawns !== true)
    )
      continue
    const timeout = timeoutOf(call, scope, target, helperOf)
    if (timeout.kind === 'value')
      timeouts.push({ ms: timeout.ms, at: where(call) })
    else if (timeout.kind === 'unread')
      problems.push(unread(call, timeout.text))
    else if (timeout.kind === 'delegated')
      problems.push(
        `${where(call)}: ${call.expression.getText()}(…) repassa o timeout de quem a chama: num spec, dê o valor na própria chamada`,
      )
    else if (required(target)) problems.push(untimed(call))
  }
  problems.push(...indirectUses(file, scope, required))
  for (const [name, helper] of used)
    for (const timeout of helper.timeouts)
      timeouts.push({ ms: timeout.ms, at: `${timeout.at} (${name})` })
  const declared = caseTimeout(file, scope)
  if (declared === undefined)
    return [
      ...problems,
      `${fileName}: dispara processos (${
        [...used.keys()].join(', ') || 'node:child_process'
      }) e não declara vi.setConfig({ testTimeout }) no topo do arquivo: o caso fica nos 5 s do vitest`,
    ]
  if (!(declared.ms > 0))
    return [
      ...problems,
      `${declared.at}: testTimeout ${declared.text}, que o guarda não lê como um número positivo: use um número ou um nome importado de test/support/hooks.ts`,
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
    .filter((file) => supportFile.test(file))
    .map((file) => {
      const relative = path.join('test', 'support', file)
      return {
        name: file.replace(supportFile, ''),
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

const untimedAt = (at: string, callee: string): string =>
  `${at}: ${callee}(…) sem timeout: o processo precisa do próprio, o do caso não o encerra`

const unreadAt = (at: string, callee: string, text: string): string =>
  `${at}: ${callee}(…) dá o timeout ${text}, que o guarda não lê como um número positivo: use um número ou um nome importado de test/support/hooks.ts`

const indirectAt = (at: string, what: string): string =>
  `${at}: ${what} fora de uma chamada direta: o guarda não segue o processo; chame a função pelo nome`

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
  const analyze = (...modules: [string, string][]) =>
    analyzeSupport(
      modules.map(([name, source]) => ({ name, file: `${name}.ts`, source })),
      names,
    )

  it('lets a helper take the timeout from its caller, and asks its callers for one', () => {
    const { helpers, problems } = analyze([
      'temp-repo',
      lines(tempRepoSource, `export const git = () => exec('git')`),
    ])
    expect(helpers.get('temp-repo')?.get('exec')?.needsTimeout).toBe(true)
    expect(helpers.get('temp-repo')?.get('TempRepo')).toEqual({
      spawns: true,
      needsTimeout: false,
      timeouts: [{ ms: 60_000, at: 'temp-repo.ts:7' }],
    })
    expect(problems).toEqual([untimedAt('temp-repo.ts:9', 'exec')])
  })

  it('does not take a timeout parameter for a timeout the process gets', () => {
    // The options type has a timeout, but nothing hands it to the process.
    expect(
      analyze([
        'temp-repo',
        lines(
          `import { spawn } from 'node:child_process'`,
          `export function helper(options: { timeout?: number } = {}) {`,
          '  return spawn(`x ${options.timeout}`)',
          `}`,
        ),
      ]).problems,
    ).toEqual([untimedAt('temp-repo.ts:3', 'spawn')])
  })

  it('reads the object in order: a later spread of the caller options wins', () => {
    const { helpers, problems } = analyze([
      'temp-repo',
      lines(
        `import { spawn } from 'node:child_process'`,
        `export function late(options: { timeout?: number } = {}) {`,
        `  return spawn('git', [], { timeout: 30_000, ...options })`,
        `}`,
        `export function early(options: { timeout?: number } = {}) {`,
        `  return spawn('git', [], { ...options, timeout: 30_000 })`,
        `}`,
        `export function hidden(extra: object) {`,
        `  return spawn('git', [], { timeout: 30_000, ...extra })`,
        `}`,
      ),
    ])
    expect(helpers.get('temp-repo')?.get('late')).toMatchObject({
      needsTimeout: true,
      timeouts: [],
    })
    expect(helpers.get('temp-repo')?.get('early')).toMatchObject({
      needsTimeout: false,
      timeouts: [{ ms: 30_000, at: 'temp-repo.ts:6' }],
    })
    expect(problems).toEqual([unreadAt('temp-repo.ts:9', 'spawn', '...extra')])
  })

  it('refuses a helper timeout it cannot read, and reads a default it can', () => {
    const { helpers, problems } = analyze([
      'temp-repo',
      lines(
        `import { spawn, spawnSync } from 'node:child_process'`,
        `import { processTimeout } from './hooks'`,
        `export function slow(limit: number) {`,
        `  return spawnSync('git', [], { timeout: limit })`,
        `}`,
        `export function withDefault({ timeout = processTimeout }: { timeout?: number } = {}) {`,
        `  return spawn('git', [], { timeout })`,
        `}`,
      ),
    ])
    expect(problems).toEqual([unreadAt('temp-repo.ts:4', 'spawnSync', 'limit')])
    expect(helpers.get('temp-repo')?.get('withDefault')?.timeouts).toEqual([
      { ms: names.get('processTimeout'), at: 'temp-repo.ts:7' },
    ])
  })

  it('finds a process started inside a template literal, not one written in a string', () => {
    expect(
      analyze([
        'temp-repo',
        lines(
          `import { spawnSync } from 'node:child_process'`,
          'export const version = () => `git ${spawnSync("git", ["--version"]).stdout}`',
          `export const script = "spawnSync('git')"`,
        ),
      ]).problems,
    ).toEqual([untimedAt('temp-repo.ts:2', 'spawnSync')])
  })

  it('follows a helper that calls another through a namespace or a loaded module', () => {
    const { helpers, problems } = analyze(
      [
        'base',
        lines(
          `import { spawnSync } from 'node:child_process'`,
          `export function run() {`,
          `  return spawnSync('git', [], { timeout: 60_000 })`,
          `}`,
        ),
      ],
      [
        'wrapper',
        lines(
          `import * as base from './base'`,
          `export const go = () => base.run()`,
          `export const again = () => require('./base').run()`,
        ),
      ],
    )
    for (const name of ['go', 'again'])
      expect(helpers.get('wrapper')?.get(name), name).toEqual({
        spawns: true,
        needsTimeout: false,
        timeouts: [{ ms: 60_000, at: 'base.ts:3' }],
      })
    expect(problems).toEqual([])
  })

  it('settles on helpers that call each other', () => {
    const { helpers } = analyze([
      'temp-repo',
      lines(
        `import { spawnSync } from 'node:child_process'`,
        `export function ping(): unknown { return pong() }`,
        `export function pong(): unknown {`,
        `  spawnSync('git', [], { timeout: 1_000 })`,
        `  return ping()`,
        `}`,
      ),
    ])
    for (const name of ['ping', 'pong'])
      expect(helpers.get('temp-repo')?.get(name)?.timeouts, name).toEqual([
        { ms: 1_000, at: 'temp-repo.ts:4' },
      ])
  })

  it('counts the timeout a helper gives another that has one of its own', () => {
    const { helpers, problems } = analyze([
      'temp-repo',
      lines(
        `import { spawn } from 'node:child_process'`,
        `export function spawnWith(command: string, { timeout = 90_000 }: { timeout?: number } = {}) {`,
        `  return spawn(command, [], { timeout })`,
        `}`,
        `export const slow = () => spawnWith('git', { timeout: 180_000 })`,
        `export const plain = () => spawnWith('git')`,
        `export function forward(options: { timeout?: number } = {}) {`,
        `  return spawnWith('git', { timeout: options.timeout })`,
        `}`,
      ),
    ])
    const helper = (name: string) => helpers.get('temp-repo')?.get(name)
    expect(helper('slow')?.timeouts.map((timeout) => timeout.ms)).toEqual(
      expect.arrayContaining([180_000, 90_000]),
    )
    expect(helper('plain')?.timeouts).toEqual([
      { ms: 90_000, at: 'temp-repo.ts:3' },
    ])
    // Handing its caller's timeout to a helper with a default needs none.
    expect(helper('forward')?.needsTimeout).toBe(false)
    expect(problems).toEqual([])
  })

  it('reads a JavaScript module of test/support/ too', () => {
    const { helpers, problems } = analyzeSupport(
      [
        {
          name: 'fake',
          file: 'fake.mjs',
          source: lines(
            `import { spawnSync } from 'node:child_process'`,
            `export function run() { return spawnSync('git') }`,
          ),
        },
      ],
      names,
    )
    expect(helpers.get('fake')?.get('run')?.spawns).toBe(true)
    expect(problems).toEqual([untimedAt('fake.mjs:2', 'spawnSync')])
  })

  it('refuses a process function it cannot follow', () => {
    expect(
      analyze([
        'temp-repo',
        lines(
          `import * as cp from 'node:child_process'`,
          `import { spawnSync } from 'node:child_process'`,
          `export const alias = spawnSync`,
          `export const all = cp`,
          `export const bound = () => cp.spawnSync.call(null, 'git')`,
        ),
      ]).problems,
    ).toEqual([
      indirectAt('temp-repo.ts:3', 'spawnSync'),
      indirectAt('temp-repo.ts:4', 'cp'),
      indirectAt('temp-repo.ts:5', 'cp.spawnSync'),
    ])
  })
})

describe('auditSpec', () => {
  const helpers = analyzeSupport(
    [
      { name: 'temp-repo', file: 'temp-repo.ts', source: tempRepoSource },
      {
        name: 'hooks',
        file: 'hooks.ts',
        source: lines(
          `import { spawn } from 'node:child_process'`,
          `export function runHook(name: string, input: unknown, { timeout = 90_000 }: { timeout?: number } = {}) {`,
          `  return spawn(name, [], { timeout })`,
          `}`,
        ),
      },
    ],
    names,
  ).helpers
  const audit = (...text: string[]): string[] =>
    auditSpec('x.spec.ts', lines(...text), helpers, names)
  const noCase = (what: string): string =>
    `x.spec.ts: dispara processos (${what}) e não declara vi.setConfig({ testTimeout }) no topo do arquivo: o caso fica nos 5 s do vitest`

  it('leaves a spec that starts no process alone', () => {
    expect(audit(`import { projectRoot } from '../support/temp-repo'`)).toEqual(
      [],
    )
    // Importing a helper that spawns, and never using it, starts nothing.
    expect(audit(`import { TempRepo } from '../support/temp-repo'`)).toEqual([])
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
        `function configure() { vi.setConfig({ testTimeout: 120_000 }) }`,
        `await run('git', { timeout: 30_000 })`,
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

  it('finds a process started from a loaded module, with no import', () => {
    expect(
      audit(
        `require('node:child_process').spawnSync('git')`,
        `;(await import('node:child_process')).execFileSync('git', [], { timeout: 1_000 })`,
      ),
    ).toEqual([
      untimedAt('x.spec.ts:1', `require('node:child_process').spawnSync`),
      noCase('node:child_process'),
    ])
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
        `const alias = run`,
      ),
    ).toEqual([
      untimedAt('x.spec.ts:7', 'run'),
      untimedAt('x.spec.ts:8', 'cp.execFileSync'),
      unreadAt('x.spec.ts:9', 'spawnSync', 'limit'),
      untimedAt('x.spec.ts:10', 'spawnSync'),
      unreadAt('x.spec.ts:11', 'spawnSync', '0'),
      untimedAt('x.spec.ts:12', 'repo.exec'),
      indirectAt('x.spec.ts:13', 'run'),
    ])
  })

  it('reads the options of a helper only where it takes them', () => {
    // runHook's second argument is the hook's input, not options.
    expect(
      audit(
        `import { runHook } from '../support/hooks'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `runHook('x', { ...input, timeout: 'input' })`,
        `runHook('x', {}, { timeout: limit })`,
      ),
    ).toEqual([unreadAt('x.spec.ts:4', 'runHook', 'limit')])
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
        `const repo = new Repo()`,
      ),
    ).toEqual([
      'x.spec.ts:2: o caso tem 30000 ms, e o processo de temp-repo.ts:7 (Repo) tem 60000 ms: o caso precisa esperar mais que o processo',
    ])
  })

  it('takes the last case timeout, as vitest does', () => {
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `spawnSync('git', [], { timeout: 90_000 })`,
        `vi.setConfig({ testTimeout: 5_000 })`,
      ),
    ).toEqual([
      'x.spec.ts:4: o caso tem 5000 ms, e o processo de x.spec.ts:3 tem 90000 ms: o caso precisa esperar mais que o processo',
    ])
  })

  it('reads a helper imported with its extension', () => {
    expect(
      audit(
        `import { exec } from '../support/temp-repo.ts'`,
        `await exec('git')`,
      ),
    ).toEqual([untimedAt('x.spec.ts:2', 'exec'), noCase('exec')])
  })

  it('reads a name where it is bound, not by its text', () => {
    // A local processTimeout is the local one, not hooks.ts's 120 s.
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `const processTimeout = 1`,
        `spawnSync('git', [], { timeout: 90_000 })`,
        `vi.setConfig({ testTimeout: processTimeout })`,
      ),
    ).toEqual([
      'x.spec.ts:4: o caso tem 1 ms, e o processo de x.spec.ts:3 tem 90000 ms: o caso precisa esperar mais que o processo',
    ])
    // Not imported from test/support/hooks.ts, the name reads as nothing.
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `spawnSync('git', [], { timeout: spawnTimeout })`,
        `vi.setConfig({ testTimeout: 120_000 })`,
      ),
    ).toEqual([unreadAt('x.spec.ts:2', 'spawnSync', 'spawnTimeout')])
  })

  it('accepts a case timeout above every process timeout, by number or by name', () => {
    expect(
      audit(
        `import { TempRepo } from '../support/temp-repo'`,
        `import { processTimeout, spawnTimeout } from '../support/hooks'`,
        `import { spawnSync } from 'node:child_process'`,
        `spawnSync('sh', [], { timeout: spawnTimeout })`,
        `vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })`,
      ),
    ).toEqual([])
  })
})
