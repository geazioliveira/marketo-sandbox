import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// Two rules for a test that waits on a child process (#23). The process gets
// a timeout of its own: vitest's case timeout does not kill a child, and a
// blocking spawnSync keeps vitest's timer from even firing. And the case
// outlasts that timeout, so a slow child is killed first and fails the case
// with its output. vitest.config.ts keeps vitest's 5 s default, which catches
// a hung pure test fast, so each spec that spawns declares its own case
// timeout with vi.setConfig. This guard reads the specs and test/support/
// with the TypeScript compiler: the parser, so comments, strings and
// template literals read as they run, and the binder, so each name resolves
// to what it is bound to where it is used. It checks both rules on every
// process call it finds, and refuses a process function used other than by
// a direct call, which it cannot follow.

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
  /** It is a function, so the guard follows it only through a direct call. */
  callable?: boolean
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

/** A source file to read, by the path it is reported with. */
interface Source {
  file: string
  source: string
}

/**
 * The files parsed and bound together, with a checker to resolve names. No
 * lib and no module resolution: the guard only needs each file's own
 * bindings, and an import resolves to its import declaration.
 */
function compile(sources: Source[]): {
  checker: ts.TypeChecker
  files: ts.SourceFile[]
} {
  const byName = new Map(sources.map((source) => [source.file, source.source]))
  const parsed = new Map<string, ts.SourceFile>()
  const lookup = (name: string): string | undefined =>
    byName.has(name)
      ? name
      : byName.has(name.slice(1))
        ? name.slice(1)
        : undefined
  const host: ts.CompilerHost = {
    getSourceFile: (name) => {
      const file = lookup(name)
      if (file === undefined) return undefined
      if (!parsed.has(file))
        parsed.set(
          file,
          ts.createSourceFile(
            file,
            byName.get(file)!,
            ts.ScriptTarget.Latest,
            true,
            /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS,
          ),
        )
      return parsed.get(file)
    },
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => lookup(name) !== undefined,
    readFile: (name) => {
      const file = lookup(name)
      return file === undefined ? undefined : byName.get(file)
    },
  }
  const program = ts.createProgram({
    rootNames: sources.map((source) => source.file),
    options: {
      noLib: true,
      noResolve: true,
      allowJs: true,
      types: [],
      target: ts.ScriptTarget.Latest,
    },
    host,
  })
  const checker = program.getTypeChecker()
  return {
    checker,
    files: sources.map((source) =>
      host.getSourceFile(source.file, ts.ScriptTarget.Latest)!,
    ),
  }
}

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

/** How a file's names resolve. */
interface Scope {
  checker: ts.TypeChecker
  /** The test/support/ module an import path names, if it names one. */
  supportOf: (module: string) => string | undefined
  /** In a test/support/ module: its name. */
  module?: string
  /** test/support/hooks.ts's named timeouts, by the name it exports. */
  names: Map<string, number>
}

/** What a name is bound to where it is used, as far as the guard reads it. */
type Binding =
  | { kind: 'import'; module: string; imported: string }
  | { kind: 'namespace'; module: string }
  | { kind: 'toplevel'; name: string; initializer?: ts.Expression }
  | {
      kind: 'parameter'
      parameter: ts.ParameterDeclaration
      initializer: ts.Expression | undefined
      /** The property a destructured name takes; none for the whole parameter. */
      property?: string
    }
  | { kind: 'const'; initializer: ts.Expression }

/**
 * A declaration at the top of the module, exported or not, by its name: a
 * private wrapper is analyzed like an export.
 */
function topLevelDeclaration(declaration: ts.Declaration): string | undefined {
  const statement = ts.isVariableDeclaration(declaration)
    ? declaration.parent.parent
    : declaration
  if (
    !ts.isSourceFile(statement.parent) ||
    !(
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isVariableStatement(statement)
    )
  )
    return undefined
  const name = (declaration as ts.NamedDeclaration).name
  return name !== undefined && ts.isIdentifier(name) ? name.text : undefined
}

/**
 * What `id` is bound to, by the checker: the declaration it resolves to
 * where it is used. A local `spawnTimeout` shadows the imported one only
 * where it is visible.
 */
function bindingOf(id: ts.Identifier, scope: Scope): Binding | undefined {
  const symbol =
    ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
      ? scope.checker.getShorthandAssignmentValueSymbol(id.parent)
      : scope.checker.getSymbolAtLocation(id)
  const declaration = symbol?.declarations?.[0]
  if (declaration === undefined) return undefined
  if (ts.isImportSpecifier(declaration)) {
    const node = declaration.parent.parent.parent
    return declaration.isTypeOnly ||
      node.importClause?.isTypeOnly === true ||
      !ts.isStringLiteral(node.moduleSpecifier)
      ? undefined
      : {
          kind: 'import',
          module: node.moduleSpecifier.text,
          imported: (declaration.propertyName ?? declaration.name).text,
        }
  }
  if (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration)) {
    const node = ts.isNamespaceImport(declaration)
      ? declaration.parent.parent
      : declaration.parent
    if (
      node.importClause?.isTypeOnly === true ||
      !ts.isStringLiteral(node.moduleSpecifier)
    )
      return undefined
    const module = node.moduleSpecifier.text
    // A default import of child_process is the module itself; of a
    // test/support/ module, its default export.
    return ts.isImportClause(declaration) && !isChildProcess(module)
      ? { kind: 'import', module, imported: 'default' }
      : { kind: 'namespace', module }
  }
  if (ts.isBindingElement(declaration)) {
    const owner = declaration.parent.parent
    const module =
      ts.isVariableDeclaration(owner) && owner.initializer !== undefined
        ? loadedModule(owner.initializer)
        : undefined
    if (module !== undefined)
      return {
        kind: 'import',
        module,
        imported: (declaration.propertyName ?? declaration.name).getText(),
      }
    return ts.isParameter(owner)
      ? {
          kind: 'parameter',
          parameter: owner,
          initializer: declaration.initializer,
          property: (declaration.propertyName ?? declaration.name).getText(),
        }
      : undefined
  }
  if (ts.isParameter(declaration))
    return {
      kind: 'parameter',
      parameter: declaration,
      initializer: declaration.initializer,
    }
  const constant =
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0
      ? declaration.initializer
      : undefined
  // A loaded module is a namespace wherever it is declared, the top of a
  // test/support/ module included.
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const module = loadedModule(declaration.initializer)
    if (module !== undefined) return { kind: 'namespace', module }
  }
  const topLevel =
    scope.module === undefined ? undefined : topLevelDeclaration(declaration)
  if (topLevel !== undefined)
    return { kind: 'toplevel', name: topLevel, initializer: constant }
  return constant === undefined
    ? undefined
    : { kind: 'const', initializer: constant }
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

/** The module an expression names: a namespace binding, or a loaded module. */
function moduleOf(expression: ts.Expression, scope: Scope): string | undefined {
  expression = unwrap(expression)
  if (ts.isIdentifier(expression)) {
    const binding = bindingOf(expression, scope)
    return binding?.kind === 'namespace' ? binding.module : undefined
  }
  return loadedModule(expression)
}

/**
 * What an expression names: a bound import, one of the module's own
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
    const binding = bindingOf(expression, scope)
    if (binding?.kind === 'import')
      return origin(binding.module, binding.imported)
    if (binding?.kind === 'toplevel' && scope.module !== undefined)
      return { kind: 'helper', module: scope.module, name: binding.name }
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const module = moduleOf(expression.expression, scope)
    if (module !== undefined) return origin(module, expression.name.text)
  }
  return undefined
}

/** `node` is the callee of a call, not a value passed around. */
const calledDirectly = (node: ts.Node): boolean =>
  ts.isCallExpression(wrapped(node).parent) &&
  (wrapped(node).parent as ts.CallExpression).expression === wrapped(node)

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

/**
 * The value of `expression` in ms, if the guard can read it as a number: a
 * number literal, or a name bound to one where it is used (a parameter's
 * default, a `const`, or an import of test/support/hooks.ts's named
 * timeouts).
 */
function valueOf(
  expression: ts.Expression,
  scope: Scope,
  seen: Set<ts.Node> = new Set(),
): number | undefined {
  expression = unwrap(expression)
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (!ts.isIdentifier(expression)) return undefined
  const binding = bindingOf(expression, scope)
  const next = (initializer: ts.Expression | undefined) =>
    initializer === undefined || seen.has(initializer)
      ? undefined
      : valueOf(initializer, scope, new Set([...seen, initializer]))
  // A parameter's default is the timeout only when no caller gives another.
  // In test/support/, a caller's timeout is read at its call of the helper;
  // a spec's own functions are not followed that way, so there a timeout
  // taken from a parameter is not read.
  if (binding?.kind === 'parameter')
    return scope.module === undefined ? undefined : next(binding.initializer)
  if (binding?.kind === 'const' || binding?.kind === 'toplevel')
    return next(binding.initializer)
  if (binding?.kind === 'import' && scope.supportOf(binding.module) === 'hooks')
    return scope.names.get(binding.imported)
  return undefined
}

/** The parameter a name is bound to, when the parameter's type has a `timeout`. */
function timedParameter(
  expression: ts.Expression,
  scope: Scope,
): Extract<Binding, { kind: 'parameter' }> | undefined {
  if (!ts.isIdentifier(expression)) return undefined
  const binding = bindingOf(expression, scope)
  return binding?.kind === 'parameter' &&
    hasTimeoutMember(binding.parameter.type, expression.getSourceFile())
    ? binding
    : undefined
}

/**
 * `expression` is the caller's options, handed on whole: a parameter typed
 * with a `timeout`, as an argument or a spread.
 */
function handsOptions(expression: ts.Expression, scope: Scope): boolean {
  const binding = timedParameter(unwrap(expression), scope)
  return binding !== undefined && binding.property === undefined
}

/**
 * `expression` is the caller's timeout: `options.timeout` of such a
 * parameter, or its `timeout` destructured with no default. Another
 * property destructured from it (`{ delay }`) is not.
 */
function handsTimeout(expression: ts.Expression, scope: Scope): boolean {
  const value = unwrap(expression)
  if (ts.isPropertyAccessExpression(value) && value.name.text === 'timeout')
    return handsOptions(value.expression, scope)
  const binding = timedParameter(value, scope)
  return binding?.property === 'timeout' && binding.initializer === undefined
}

/**
 * The timeout a call gives its process, as the guard reads it, over every
 * way the options can come out (a ternary has two): every explicit value,
 * whether some way hands the caller's timeout on, and whether some way gives
 * none. Or unreadable, when some way gives one the guard cannot read.
 */
type CallTimeout =
  | { kind: 'read'; values: number[]; delegated: boolean; missing: boolean }
  | { kind: 'unread'; text: string }

const noTimeout: CallTimeout = {
  kind: 'read',
  values: [],
  delegated: false,
  missing: true,
}

/**
 * The timeout in a call's options, read in order as the object is built: a
 * `timeout` property, or a spread that comes after it and may replace it.
 * A spread of the caller's options (a parameter typed with a `timeout`)
 * hands the timeout to the caller, and keeps the earlier one for a caller
 * that gives none; a spread the guard cannot see into makes it unreadable.
 */
function timeoutOf(
  call: ts.CallExpression,
  scope: Scope,
  target: Target | undefined,
  helperOf: (target: Target | undefined) => Helper | undefined,
): CallTimeout {
  const fromObject = (
    object: ts.ObjectLiteralExpression,
    timeout: CallTimeout = noTimeout,
  ): CallTimeout => {
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = objectOf(property.expression, scope)
        timeout =
          spread !== undefined
            ? fromObject(spread, timeout)
            : !handsOptions(property.expression, scope)
              ? { kind: 'unread', text: `...${property.expression.getText()}` }
              : timeout.kind === 'unread'
                ? timeout
                : // The caller must give a timeout now, and an earlier one
                  // stays for a caller that gives none.
                  { ...timeout, delegated: true, missing: false }
        continue
      }
      const value = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : undefined
      if (value === undefined || property.name?.getText() !== 'timeout')
        continue
      if (handsTimeout(value, scope)) {
        timeout = { kind: 'read', values: [], delegated: true, missing: false }
        continue
      }
      const ms = valueOf(value, scope)
      timeout =
        ms === undefined || !(ms > 0)
          ? { kind: 'unread', text: value.getText() }
          : { kind: 'read', values: [ms], delegated: false, missing: false }
    }
    return timeout
  }
  /** Either branch may run: every value, and any branch that delegates or gives none. */
  const either = (a: CallTimeout, b: CallTimeout): CallTimeout =>
    a.kind === 'unread'
      ? a
      : b.kind === 'unread'
        ? b
        : {
            kind: 'read',
            values: [...a.values, ...b.values],
            delegated: a.delegated || b.delegated,
            missing: a.missing || b.missing,
          }
  /** The options an argument gives, or nothing when it is not options. */
  const fromArgument = (argument: ts.Expression): CallTimeout | undefined => {
    const value = unwrap(argument)
    if (ts.isConditionalExpression(value))
      return either(
        fromArgument(value.whenTrue) ?? noTimeout,
        fromArgument(value.whenFalse) ?? noTimeout,
      )
    const object = objectOf(value, scope)
    if (object !== undefined) return fromObject(object)
    if (handsOptions(value, scope))
      return { kind: 'read', values: [], delegated: true, missing: false }
    // Options handed to a helper that the guard cannot see into may replace
    // its timeout with any other.
    return target?.kind === 'helper'
      ? { kind: 'unread', text: argument.getText() }
      : undefined
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
  return (
    options
      .map(fromArgument)
      .filter((timeout) => timeout !== undefined)
      .at(-1) ?? noTimeout
  )
}

/** The object literal an expression is, or a `const` it names is bound to. */
function objectOf(
  expression: ts.Expression,
  scope: Scope,
): ts.ObjectLiteralExpression | undefined {
  const value = unwrap(expression)
  if (ts.isObjectLiteralExpression(value)) return value
  if (!ts.isIdentifier(value)) return undefined
  const binding = bindingOf(value, scope)
  const initializer =
    binding?.kind === 'const' || binding?.kind === 'toplevel'
      ? binding.initializer
      : undefined
  return initializer !== undefined &&
    ts.isObjectLiteralExpression(unwrap(initializer))
    ? (unwrap(initializer) as ts.ObjectLiteralExpression)
    : undefined
}

const untimed = (call: ts.CallExpression): string =>
  `${where(call)}: ${call.expression.getText()}(…) sem timeout: o processo precisa do próprio, o do caso não o encerra`

const unread = (call: ts.CallExpression, text: string): string =>
  `${where(call)}: ${call.expression.getText()}(…) dá o timeout ${text}, que o guarda não lê como um número positivo: use um número ou um nome importado de test/support/hooks.ts`

/** A name in a type, which starts nothing: `repo: HookRepo`, `typeof runHook`. */
const inType = (node: ts.Node): boolean =>
  node.parent !== undefined &&
  (ts.isTypeReferenceNode(node.parent) ||
    ts.isTypeQueryNode(node.parent) ||
    ts.isQualifiedName(node.parent) ||
    ts.isExpressionWithTypeArguments(node.parent))

/**
 * Every place `root` uses a process function (a child_process one, or a
 * test/support/ function that starts a process, per `follows`) other than
 * by a direct call: an alias, `.call`, a callback, a namespace or a loaded
 * module passed around. The guard cannot follow the process, or the timeout
 * given to it, from there.
 */
function indirectUses(
  root: ts.Node,
  scope: Scope,
  follows: (target: Target | undefined) => boolean,
): string[] {
  const problems: string[] = []
  const refuse = (node: ts.Node, what: string): void => {
    problems.push(
      `${where(node)}: ${what} fora de uma chamada direta: o guarda não segue o processo; chame a função pelo nome`,
    )
  }
  const processModule = (module: string | undefined): boolean =>
    module !== undefined &&
    (isChildProcess(module) || scope.supportOf(module) !== undefined)
  const asReceiver = (node: ts.Node): boolean => {
    const parent = wrapped(node).parent
    return (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === wrapped(node)
    )
  }
  for (const node of walk(root)) {
    if (
      (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) &&
      !inType(node) &&
      follows(targetOf(node, scope)) &&
      !calledDirectly(node)
    )
      refuse(node, node.getText())
    if (ts.isIdentifier(node) && !declares(node)) {
      const binding = bindingOf(node, scope)
      if (
        binding?.kind === 'namespace' &&
        processModule(binding.module) &&
        !asReceiver(node)
      )
        refuse(node, node.text)
    }
    if (ts.isCallExpression(node)) {
      const module = loadedModule(node)
      if (
        processModule(module) &&
        !ts.isVariableDeclaration(wrapped(node).parent) &&
        !asReceiver(node)
      )
        refuse(node, node.getText())
    }
  }
  return problems
}

/**
 * A target the guard follows only through a direct call: a child_process
 * function, or a test/support/ function that starts a process (its timeout,
 * or the one a call gives it, is read at the call).
 */
const follows = (
  target: Target | undefined,
  helperOf: (target: Target | undefined) => Helper | undefined,
): boolean => {
  const helper = helperOf(target)
  return (
    target?.kind === 'api' ||
    helper?.needsTimeout === true ||
    (helper?.spawns === true && helper.callable === true)
  )
}

// ---------------------------------------------------------------------------
// test/support/

/** A test/support/ module, by the name a spec imports it with. */
interface SupportModule extends Source {
  name: string
}

/** A module file of test/support/, TypeScript or JavaScript. */
const supportFile = /\.(?:[cm]?[jt]s)$/

const supportFromSupport = (module: string): string | undefined =>
  /^\.\/([\w-]+)(?:\.[cm]?[jt]s)?$/.exec(module)?.[1]

/** From a spec under test/ (`../support/x`) or under src/ (`../../test/support/x`). */
const supportFromSpec = (module: string): string | undefined =>
  /^(?:\.\.?\/)+(?:test\/)?support\/([\w-]+)(?:\.[cm]?[jt]s)?$/.exec(
    module,
  )?.[1]

/** The names a top-level statement declares, exported or not. */
function declaredNames(statement: ts.Statement): string[] {
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

/** The function a top-level statement declares under `name`, if it is one. */
function declaredFunction(
  statement: ts.Statement,
  name: string,
): ts.SignatureDeclaration | undefined {
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
  return fn !== undefined && ts.isFunctionLike(fn) ? fn : undefined
}

/** A function or class declared as `export default`. */
const isDefaultExport = (
  statement: ts.FunctionDeclaration | ts.ClassDeclaration,
): boolean =>
  (ts.getModifiers(statement) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
  )

/** The function an anonymous default export is: `export default function ()`, `export default () =>`. */
function anonymousDefault(
  statement: ts.Statement,
): ts.SignatureDeclaration | undefined {
  if (
    ts.isFunctionDeclaration(statement) &&
    statement.name === undefined &&
    isDefaultExport(statement)
  )
    return statement
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
    const value = unwrap(statement.expression)
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
      return value
  }
  return undefined
}

/** The position of a function's parameter typed with a `timeout`. */
function optionsIndex(
  statement: ts.Statement,
  name: string,
): number | undefined {
  const fn = declaredFunction(statement, name)
  if (fn === undefined) return undefined
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
  const { checker, files } = compile(modules)
  const helpers = new Map<string, Map<string, Helper>>()
  const exports: Export[] = []
  const scopes: { file: ts.SourceFile; scope: Scope }[] = []
  modules.forEach((module, index) => {
    const file = files[index]
    const scope: Scope = {
      checker,
      supportOf: supportFromSupport,
      module: module.name,
      names,
    }
    scopes.push({ file, scope })
    const byName = new Map<string, Helper>()
    helpers.set(module.name, byName)
    for (const statement of file.statements) {
      const declared = declaredNames(statement)
      // An anonymous default export is a helper named `default`; any other
      // top-level statement that declares nothing, like a bare call, is
      // still read for the processes it starts.
      if (declared.length === 0) {
        const fn = anonymousDefault(statement)
        const isDefault =
          fn !== undefined ||
          (ts.isClassDeclaration(statement) && isDefaultExport(statement)) ||
          (ts.isExportAssignment(statement) && !statement.isExportEquals)
        const index =
          fn?.parameters.findIndex((parameter) =>
            hasTimeoutMember(parameter.type, file),
          ) ?? -1
        const helper: Helper = {
          spawns: false,
          needsTimeout: false,
          timeouts: [],
          optionsAt: index < 0 ? undefined : index,
          callable: fn !== undefined,
        }
        if (isDefault && !byName.has('default')) byName.set('default', helper)
        exports.push({ statement, scope, helper })
      }
      for (const name of declared) {
        const helper: Helper = {
          spawns: false,
          needsTimeout: false,
          timeouts: [],
          optionsAt: optionsIndex(statement, name),
          callable: declaredFunction(statement, name) !== undefined,
        }
        byName.set(name, helper)
        exports.push({ statement, scope, helper })
      }
    }
  })
  // The names a module exports under another name: `export { run as
  // execute }`, `export default run`, `export default function`, and the
  // re-exports of another module of test/support/.
  const reexports: (() => void)[] = []
  modules.forEach((module, index) => {
    const byName = helpers.get(module.name)!
    for (const statement of files[index].statements) {
      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement)) &&
        statement.name !== undefined &&
        isDefaultExport(statement)
      )
        byName.set('default', byName.get(statement.name.text)!)
      if (
        ts.isExportAssignment(statement) &&
        !statement.isExportEquals &&
        ts.isIdentifier(statement.expression)
      ) {
        const helper = byName.get(statement.expression.text)
        if (helper !== undefined) byName.set('default', helper)
      }
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue
      const from =
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? supportFromSupport(statement.moduleSpecifier.text)
          : undefined
      const source = () =>
        statement.moduleSpecifier === undefined
          ? byName
          : helpers.get(from ?? '')
      const clause = statement.exportClause
      reexports.push(() => {
        const origin = source()
        if (origin === undefined) return
        if (clause === undefined) {
          for (const [name, helper] of origin)
            if (name !== 'default' && !byName.has(name))
              byName.set(name, helper)
          return
        }
        if (ts.isNamedExports(clause))
          for (const element of clause.elements) {
            if (element.isTypeOnly) continue
            const helper = origin.get(
              (element.propertyName ?? element.name).text,
            )
            if (helper !== undefined) byName.set(element.name.text, helper)
          }
      })
    }
  })
  // Re-exports can chain; each pass settles one more link.
  for (let pass = 0; pass < modules.length + 1; pass++)
    for (const reexport of reexports) reexport()
  // A namespace re-exported (`export * as base from './base'`, or `export {
  // base }` of an `import * as base`) is refused: the guard does not follow
  // a namespace out of its module.
  const namespaceExports = files.flatMap((file) =>
    file.statements.flatMap((statement) => {
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) return []
      const clause = statement.exportClause
      const refuse = (what: string) =>
        `${where(statement)}: ${what}: o guarda não segue um namespace re-exportado; exporte as funções pelo nome`
      if (clause !== undefined && ts.isNamespaceExport(clause))
        return [refuse(`export * as ${clause.name.text}`)]
      if (
        clause === undefined ||
        !ts.isNamedExports(clause) ||
        statement.moduleSpecifier !== undefined
      )
        return []
      return clause.elements.flatMap((element) => {
        // What the exported name is bound to in this module.
        const local =
          checker.getExportSpecifierLocalTargetSymbol(element)
            ?.declarations?.[0]
        const module =
          local === undefined
            ? undefined
            : ts.isNamespaceImport(local) &&
                ts.isStringLiteral(local.parent.parent.moduleSpecifier)
              ? local.parent.parent.moduleSpecifier.text
              : ts.isVariableDeclaration(local) &&
                  local.initializer !== undefined
                ? loadedModule(local.initializer)
                : undefined
        return module !== undefined &&
          (isChildProcess(module) || supportFromSupport(module) !== undefined)
          ? [refuse(`export { ${element.getText()} }`)]
          : []
      })
    }),
  )
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
        ...entry.helper,
        spawns:
          [...walk(entry.statement)].some(
            (node) => targetOf(node, entry.scope)?.kind === 'api',
          ) || used.some((other) => other.spawns),
        // Handing the caller's timeout to a helper with a default of its own
        // leaves the default when the caller gives none: only a callee
        // with no timeout of its own makes the caller's required.
        needsTimeout: calls.some(
          ({ required, timeout }) =>
            required && timeout.kind === 'read' && timeout.delegated,
        ),
        timeouts: distinct([
          ...calls.flatMap(({ call, timeout }) =>
            timeout.kind === 'read'
              ? timeout.values.map((ms) => ({ ms, at: where(call) }))
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
        if (timeout.kind === 'unread') return [unread(call, timeout.text)]
        return timeout.missing && required ? [untimed(call)] : []
      }),
    ),
    ...scopes.flatMap(({ file, scope }) =>
      indirectUses(file, scope, (target) => follows(target, helperOf)),
    ),
    ...namespaceExports,
  ]
  return { helpers, problems: [...new Set(problems)] }
}

// ---------------------------------------------------------------------------
// A spec

/**
 * `vi.setConfig` of vitest itself: the global `vi` (vitest's `globals`), or
 * one imported from 'vitest'. A local `vi` with a `setConfig` of its own
 * sets nothing.
 */
function isVitestSetConfig(callee: ts.Expression, scope: Scope): boolean {
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== 'setConfig' ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== 'vi'
  )
    return false
  const declaration = scope.checker.getSymbolAtLocation(callee.expression)
    ?.declarations?.[0]
  if (declaration === undefined) return true
  if (!ts.isImportSpecifier(declaration)) return false
  const node = declaration.parent.parent.parent
  return (
    ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text === 'vitest' &&
    (declaration.propertyName ?? declaration.name).text === 'vi'
  )
}

/**
 * The last value an object gives `key`, read in the order it is built,
 * through spreads of object literals and of `const`s bound to one, and
 * shorthand properties. A spread the guard cannot see into may set the key
 * to anything, so from there the value is unreadable until the key is set
 * again.
 */
function lastValue(
  object: ts.ObjectLiteralExpression,
  key: string,
  scope: Scope,
  found: { value: ts.Expression } | { unread: string } | undefined = undefined,
): { value: ts.Expression } | { unread: string } | undefined {
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = objectOf(property.expression, scope)
      found =
        spread !== undefined
          ? lastValue(spread, key, scope, found)
          : { unread: `...${property.expression.getText()}` }
      continue
    }
    const value = ts.isPropertyAssignment(property)
      ? property.initializer
      : ts.isShorthandPropertyAssignment(property)
        ? property.name
        : undefined
    if (value !== undefined && property.name?.getText() === key)
      found = { value }
  }
  return found
}

/**
 * A timeout a spec gives with `vi.setConfig({ testTimeout, hookTimeout })`
 * as a statement of the file itself: one inside a function may never run.
 * The last one wins, as it does in vitest.
 */
function configTimeout(
  file: ts.SourceFile,
  scope: Scope,
  key: 'testTimeout' | 'hookTimeout',
): (Timeout & { text: string }) | undefined {
  let found: (Timeout & { text: string }) | undefined
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement)) continue
    const call = statement.expression
    if (
      !ts.isCallExpression(call) ||
      !isVitestSetConfig(call.expression, scope)
    )
      continue
    const argument = call.arguments[0]
    if (argument === undefined) continue
    const config = objectOf(argument, scope)
    const last =
      config === undefined
        ? { unread: argument.getText() }
        : lastValue(config, key, scope)
    if (last === undefined) continue
    found =
      'unread' in last
        ? { ms: Number.NaN, at: where(call), text: last.unread }
        : {
            ms: valueOf(last.value, scope) ?? Number.NaN,
            at: where(call),
            text: last.value.getText(),
          }
  }
  return found
}

/** vitest's timeout for a hook with none of its own and no `hookTimeout`. */
const defaultHookTimeout = 10_000

/**
 * What a vitest function is, from its root name: `it`/`test` (a case,
 * `.each`, `.concurrent` and a `test.extend` included), a hook, `describe`,
 * or nothing vitest's. The name is vitest's when it is global (vitest's
 * `globals`), imported from 'vitest', or a `const` made by `.extend` of one.
 */
function vitestRole(
  expression: ts.Expression,
  scope: Scope,
): 'case' | 'hook' | 'describe' | undefined {
  let root = expression
  /** The member names from the root on: `vitest.test.each` gives test, each. */
  const members: string[] = []
  while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root)) {
    if (ts.isPropertyAccessExpression(root)) members.unshift(root.name.text)
    root = root.expression
  }
  if (!ts.isIdentifier(root)) return undefined
  const declaration = scope.checker.getSymbolAtLocation(root)?.declarations?.[0]
  let name: string | undefined
  if (declaration === undefined) name = root.text
  else if (ts.isNamespaceImport(declaration)) {
    // `import * as vitest from 'vitest'`: the member after it is the name.
    const node = declaration.parent.parent
    if (
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'vitest'
    )
      name = members[0]
  } else if (ts.isImportSpecifier(declaration)) {
    const node = declaration.parent.parent.parent
    if (
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'vitest'
    )
      name = (declaration.propertyName ?? declaration.name).text
  } else if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined
  ) {
    const made = unwrap(declaration.initializer)
    if (
      ts.isCallExpression(made) &&
      ts.isPropertyAccessExpression(made.expression) &&
      made.expression.name.text === 'extend'
    )
      return vitestRole(made.expression.expression, scope)
  }
  if (name === 'it' || name === 'test') return 'case'
  if (
    name === 'beforeAll' ||
    name === 'beforeEach' ||
    name === 'afterAll' ||
    name === 'afterEach'
  )
    return 'hook'
  return name === 'describe' ? 'describe' : undefined
}

/** A case or hook of vitest, and the timeout it gives itself, if any. */
interface Runner {
  kind: 'case' | 'hook'
  call: ts.CallExpression
  timeout?: ts.Expression
  /** The options it gives itself, where the guard cannot read the timeout. */
  unread?: string
}

/**
 * The case or hook a function runs as, when `node` (the function, or a name
 * of it) is handed to `it`, `test` or a hook, or is a fixture of
 * `test.extend`, which runs in the case's time. A case gives its timeout as
 * a number or `{ timeout }` beside the function, a hook as the number after
 * it.
 */
function runnerFor(node: ts.Node, scope: Scope): Runner | undefined {
  const argument = wrapped(node)
  const parent = argument.parent
  if (
    ts.isCallExpression(parent) &&
    parent.arguments.includes(argument as ts.Expression)
  ) {
    const role = vitestRole(parent.expression, scope)
    if (role !== 'case' && role !== 'hook') return undefined
    // A number, a name, or an options object (read in order, through
    // spreads and `const`s) beside the function.
    let timeout: ts.Expression | undefined
    let unread: string | undefined
    parent.arguments.forEach((other, index) => {
      if (other === argument || (role === 'case' && index === 0)) return
      const options = objectOf(other, scope)
      if (options === undefined) {
        timeout = other
        return
      }
      const last = lastValue(options, 'timeout', scope)
      if (last === undefined) return
      if ('unread' in last) unread = last.unread
      else {
        timeout = last.value
        unread = undefined
      }
    })
    return { kind: role, call: parent, timeout, unread }
  }
  // A fixture: a function in the object handed to `.extend`, alone or as
  // the tuple `[fn, options]`, whose options may give it a timeout.
  const tuple =
    ts.isArrayLiteralExpression(parent) && parent.elements[0] === argument
      ? parent
      : undefined
  const value = tuple ?? argument
  const object = ts.isMethodDeclaration(value)
    ? value.parent
    : ts.isPropertyAssignment(value.parent)
      ? value.parent.parent
      : undefined
  const call = object?.parent
  if (
    object === undefined ||
    !ts.isObjectLiteralExpression(object) ||
    call === undefined ||
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== 'extend' ||
    vitestRole(call.expression.expression, scope) !== 'case'
  )
    return undefined
  const options =
    tuple?.elements[1] === undefined
      ? undefined
      : objectOf(tuple.elements[1], scope)
  if (tuple?.elements[1] !== undefined && options === undefined)
    return { kind: 'case', call, unread: tuple.elements[1].getText() }
  const last =
    options === undefined ? undefined : lastValue(options, 'timeout', scope)
  return last === undefined
    ? { kind: 'case', call }
    : 'unread' in last
      ? { kind: 'case', call, unread: last.unread }
      : { kind: 'case', call, timeout: last.value }
}

/**
 * The name a function is reached by: its declaration or the `const` it is
 * assigned to, or, for a method of an object literal assigned to a `const`,
 * that name and the member (`helpers.body`).
 */
function functionName(
  fn: ts.Node,
): { name: ts.Identifier; member?: string } | undefined {
  if (ts.isFunctionDeclaration(fn))
    return fn.name === undefined ? undefined : { name: fn.name }
  const holder = wrapped(fn).parent
  if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name))
    return { name: holder.name }
  const member = ts.isMethodDeclaration(fn)
    ? fn
    : ts.isPropertyAssignment(holder)
      ? holder
      : undefined
  const object = member?.parent
  const owner = object?.parent
  return member !== undefined &&
    object !== undefined &&
    ts.isObjectLiteralExpression(object) &&
    owner !== undefined &&
    ts.isVariableDeclaration(owner) &&
    ts.isIdentifier(owner.name)
    ? { name: owner.name, member: member.name.getText() }
    : undefined
}

/**
 * Every case or hook a node can run in, or `file` when it runs in none the
 * guard sees. A function handed to a case by name (`it('x', body, 5_000)`),
 * or called from one, runs in each case that names or calls it: the guard
 * follows each use of the function's name to its case.
 */
function runnersOf(
  site: ts.Node,
  scope: Scope,
  references: (name: ts.Identifier) => ts.Identifier[],
  seen: Set<ts.Node> = new Set(),
): (Runner | 'file')[] {
  for (
    let current = site;
    current.parent !== undefined;
    current = current.parent
  ) {
    if (!ts.isFunctionLike(current)) continue
    const runner = runnerFor(current, scope)
    if (runner !== undefined) return [runner]
    const reached = functionName(current)
    if (reached === undefined || seen.has(current)) continue
    seen.add(current)
    const outside = current
    /**
     * The places the function is used: each use of its name, or of
     * `name.member`, and, through an alias (`const alias = body`), each use
     * of the alias.
     */
    const usesOf = (name: ts.Identifier, member?: string): ts.Node[] =>
      references(name)
        .filter((use) => use.pos < outside.pos || use.end > outside.end)
        .flatMap((use): ts.Node[] => {
          if (member === undefined) return [use]
          const access = use.parent
          return ts.isPropertyAccessExpression(access) &&
            access.expression === use &&
            access.name.text === member
            ? [access]
            : []
        })
        .flatMap((use) => {
          const holder = wrapped(use).parent
          if (
            !ts.isVariableDeclaration(holder) ||
            !ts.isIdentifier(holder.name) ||
            holder.initializer !== wrapped(use) ||
            seen.has(holder)
          )
            return [use]
          seen.add(holder)
          return usesOf(holder.name)
        })
    const uses = usesOf(reached.name, reached.member)
    if (uses.length > 0)
      return uses.flatMap((use) => {
        const direct = runnerFor(use, scope)
        return direct !== undefined
          ? [direct]
          : runnersOf(use, scope, references, seen)
      })
  }
  return ['file']
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
  const { checker, files } = compile([{ file: fileName, source }])
  const file = files[0]
  const scope: Scope = { checker, supportOf: supportFromSpec, names }
  const helperOf = (target: Target | undefined): Helper | undefined =>
    target?.kind === 'helper'
      ? helpers.get(target.module)?.get(target.name)
      : undefined
  const required = (target: Target | undefined): boolean =>
    target?.kind === 'api' || helperOf(target)?.needsTimeout === true
  /**
   * The spawning helpers the spec uses, and whether it uses child_process:
   * as values, outside types. An import never used, or used only in a type
   * (`typeof runHook`), starts nothing.
   */
  const used: { node: ts.Node; helper: Helper }[] = []
  let startsProcesses = false
  for (const node of walk(file)) {
    if (inType(node)) continue
    const target = targetOf(node, scope)
    const helper = helperOf(target)
    if (target?.kind === 'api') startsProcesses = true
    if (helper?.spawns === true) used.push({ node, helper })
  }
  if (used.length === 0 && !startsProcesses) return []
  const problems: string[] = []
  /** Each process timeout, with the node whose case or hook waits on it. */
  const timeouts: (Timeout & { site: ts.Node })[] = []
  for (const call of [...walk(file)].filter(ts.isCallExpression)) {
    const target = targetOf(call.expression, scope)
    if (
      target === undefined ||
      (target.kind === 'helper' && helperOf(target)?.spawns !== true)
    )
      continue
    const timeout = timeoutOf(call, scope, target, helperOf)
    if (timeout.kind === 'unread') {
      problems.push(unread(call, timeout.text))
      continue
    }
    for (const ms of timeout.values)
      timeouts.push({ ms, at: where(call), site: call })
    if (timeout.delegated)
      problems.push(
        `${where(call)}: ${call.expression.getText()}(…) repassa o timeout de quem a chama: num spec, dê o valor na própria chamada`,
      )
    else if (timeout.missing && required(target)) problems.push(untimed(call))
  }
  problems.push(
    ...indirectUses(file, scope, (target) => follows(target, helperOf)),
  )
  for (const { node, helper } of used)
    for (const timeout of helper.timeouts)
      timeouts.push({
        ms: timeout.ms,
        at: `${timeout.at} (${node.getText()})`,
        site: node,
      })
  const declared = configTimeout(file, scope, 'testTimeout')
  if (declared === undefined)
    return [
      ...problems,
      `${fileName}: dispara processos (${
        [...new Set(used.map(({ node }) => node.getText()))].join(', ') ||
        'node:child_process'
      }) e não declara vi.setConfig({ testTimeout }) no topo do arquivo: o caso fica nos 5 s do vitest`,
    ]
  const hooks = configTimeout(file, scope, 'hookTimeout')
  const unreadLimit = (at: string, what: string, text: string): string =>
    `${at}: ${what} ${text}, que o guarda não lê como um número positivo: use um número ou um nome importado de test/support/hooks.ts`
  for (const config of [declared, hooks])
    if (config !== undefined && !(config.ms > 0))
      problems.push(
        unreadLimit(
          config.at,
          config === declared ? 'testTimeout' : 'hookTimeout',
          config.text,
        ),
      )
  if (!(declared.ms > 0) || (hooks !== undefined && !(hooks.ms > 0)))
    return problems
  /**
   * The time the case or hook around a node gives it: its own timeout, or
   * the file's `testTimeout`, or `hookTimeout` (10 s when not set). Outside
   * any case or hook, as in a function of the file, the file's
   * `testTimeout`.
   */
  /** Every use of a name in the file, by the symbol it binds, built once. */
  let index: Map<ts.Symbol, ts.Identifier[]> | undefined
  const references = (name: ts.Identifier): ts.Identifier[] => {
    if (index === undefined) {
      index = new Map()
      for (const node of walk(file)) {
        if (!ts.isIdentifier(node) || declares(node)) continue
        const symbol = checker.getSymbolAtLocation(node)
        if (symbol !== undefined)
          index.set(symbol, [...(index.get(symbol) ?? []), node])
      }
    }
    const symbol = checker.getSymbolAtLocation(name)
    return symbol === undefined ? [] : (index.get(symbol) ?? [])
  }
  /**
   * The time a case or hook gives: its own timeout, or the file's
   * `testTimeout`, or `hookTimeout` (10 s when not set). Outside any case
   * or hook the guard sees, the file's `testTimeout`.
   */
  const limitOf = (
    runner: Runner | 'file',
  ): { ms: number; at: string; what: string } | undefined => {
    if (runner === 'file')
      return { ms: declared.ms, at: declared.at, what: 'caso' }
    const what = runner.kind === 'hook' ? 'hook' : 'caso'
    if (runner.unread !== undefined) {
      problems.push(
        unreadLimit(
          where(runner.call),
          `o ${what} dá o timeout`,
          runner.unread,
        ),
      )
      return undefined
    }
    if (runner.timeout !== undefined) {
      const ms = valueOf(runner.timeout, scope)
      if (ms === undefined || !(ms > 0)) {
        problems.push(
          unreadLimit(
            where(runner.call),
            `o ${what} dá o timeout`,
            runner.timeout.getText(),
          ),
        )
        return undefined
      }
      return { ms, at: where(runner.call), what }
    }
    if (runner.kind === 'hook')
      return hooks === undefined
        ? { ms: defaultHookTimeout, at: where(runner.call), what }
        : { ms: hooks.ms, at: hooks.at, what }
    return { ms: declared.ms, at: declared.at, what }
  }
  const late = new Map<string, string>()
  for (const timeout of timeouts)
    for (const runner of runnersOf(timeout.site, scope, references)) {
      const limit = limitOf(runner)
      if (limit === undefined || timeout.ms < limit.ms) continue
      const message = `${limit.at}: o ${limit.what} tem ${limit.ms} ms, e o processo de ${timeout.at} tem ${timeout.ms} ms: o ${limit.what} precisa esperar mais que o processo`
      late.set(message, message)
    }
  return [...new Set(problems), ...late.values()]
}

// ---------------------------------------------------------------------------
// The repository

const read = (file: string): string =>
  readFileSync(path.join(root, file), 'utf8')

const names = namedTimeouts(
  ts.createSourceFile(
    'test/support/hooks.ts',
    read('test/support/hooks.ts'),
    ts.ScriptTarget.Latest,
    true,
  ),
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
    expect(helpers.get('temp-repo')?.get('TempRepo')).toMatchObject({
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
    // The 30 s stays for a caller that gives no timeout of its own.
    expect(helpers.get('temp-repo')?.get('late')).toMatchObject({
      needsTimeout: true,
      timeouts: [{ ms: 30_000, at: 'temp-repo.ts:3' }],
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
      expect(helpers.get('wrapper')?.get(name), name).toMatchObject({
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

  it('takes only the timeout itself from the caller, not another option', () => {
    // delay is not the caller's timeout, even in options typed with one.
    const { helpers, problems } = analyze([
      'temp-repo',
      lines(
        `import { spawn } from 'node:child_process'`,
        `export function helper({ delay }: { timeout?: number; delay?: number } = {}) {`,
        `  return spawn('x', [], { timeout: delay })`,
        `}`,
        `export function whole(options: { timeout?: number } = {}) {`,
        `  return spawn('x', [], { timeout: options })`,
        `}`,
      ),
    ])
    expect(helpers.get('temp-repo')?.get('helper')?.needsTimeout).toBe(false)
    expect(problems).toEqual([
      unreadAt('temp-repo.ts:3', 'spawn', 'delay'),
      unreadAt('temp-repo.ts:6', 'spawn', 'options'),
    ])
  })

  it('reads a name where it is bound, in its own scope', () => {
    // A `const limit` in another function is not the parameter here.
    expect(
      analyze([
        'temp-repo',
        lines(
          `import { spawnSync } from 'node:child_process'`,
          `export function run(limit: number) {`,
          `  return spawnSync('git', [], { timeout: limit })`,
          `}`,
          `export function other() { const limit = 1_000; return limit }`,
        ),
      ]).problems,
    ).toEqual([unreadAt('temp-repo.ts:3', 'spawnSync', 'limit')])
  })

  it('reads child_process loaded at the top of a helper', () => {
    expect(
      analyze([
        'temp-repo',
        lines(
          `const cp = require('node:child_process')`,
          `export const run = () => cp.spawnSync('git')`,
        ),
      ]).problems,
    ).toEqual([untimedAt('temp-repo.ts:2', 'cp.spawnSync')])
  })

  it('reads a private function of the module like an export', () => {
    const { helpers, problems } = analyze([
      'temp-repo',
      lines(
        `import { spawnSync } from 'node:child_process'`,
        `function child() { return spawnSync('git') }`,
        `export const run = () => child()`,
        `spawnSync('git', [], { encoding: 'utf8' })`,
      ),
    ])
    expect(helpers.get('temp-repo')?.get('run')?.spawns).toBe(true)
    expect(problems).toEqual([
      untimedAt('temp-repo.ts:2', 'spawnSync'),
      untimedAt('temp-repo.ts:4', 'spawnSync'),
    ])
  })

  it('keeps what each branch of a ternary gives', () => {
    const { helpers, problems } = analyze([
      'temp-repo',
      lines(
        `import { spawn } from 'node:child_process'`,
        `export function half(flag: boolean) {`,
        `  return spawn('git', [], flag ? {} : { timeout: 30_000 })`,
        `}`,
        `export function mixed(flag: boolean, options: { timeout?: number } = {}) {`,
        `  return spawn('git', [], flag ? { ...options } : { timeout: 45_000 })`,
        `}`,
      ),
    ])
    // One branch of half gives no timeout.
    expect(problems).toEqual([untimedAt('temp-repo.ts:3', 'spawn')])
    // mixed hands the caller's timeout on, and keeps its own 45 s.
    expect(helpers.get('temp-repo')?.get('mixed')).toMatchObject({
      needsTimeout: true,
      timeouts: [{ ms: 45_000, at: 'temp-repo.ts:6' }],
    })
  })

  it('reads an anonymous default export', () => {
    const arrow = analyze([
      'base',
      lines(
        `import { spawnSync } from 'node:child_process'`,
        `export default () => spawnSync('git')`,
      ),
    ])
    expect(arrow.helpers.get('base')?.get('default')?.spawns).toBe(true)
    expect(arrow.problems).toEqual([untimedAt('base.ts:2', 'spawnSync')])
    const declared = analyze([
      'base',
      lines(
        `import { spawnSync } from 'node:child_process'`,
        `export default function () { return spawnSync('git', [], { timeout: 1_000 }) }`,
      ),
    ])
    expect(declared.helpers.get('base')?.get('default')).toMatchObject({
      spawns: true,
      timeouts: [{ ms: 1_000, at: 'base.ts:2' }],
    })
  })

  it('reads a class exported as default, named or not', () => {
    const named = analyze([
      'base',
      lines(
        `import { spawnSync } from 'node:child_process'`,
        `export default class Repo { git() { return spawnSync('git', [], { timeout: 60_000 }) } }`,
      ),
    ])
    expect(named.helpers.get('base')?.get('default')).toBe(
      named.helpers.get('base')?.get('Repo'),
    )
    expect(named.helpers.get('base')?.get('default')).toMatchObject({
      spawns: true,
      timeouts: [{ ms: 60_000, at: 'base.ts:2' }],
    })
    const anonymous = analyze([
      'base',
      lines(
        `import { spawnSync } from 'node:child_process'`,
        `export default class { git() { return spawnSync('git') } }`,
      ),
    ])
    expect(anonymous.helpers.get('base')?.get('default')?.spawns).toBe(true)
    expect(anonymous.problems).toEqual([untimedAt('base.ts:2', 'spawnSync')])
  })

  it('registers a helper under every name it is exported with', () => {
    const { helpers } = analyze(
      [
        'base',
        lines(
          `import { spawnSync } from 'node:child_process'`,
          `function run() { return spawnSync('git', [], { timeout: 60_000 }) }`,
          `export { run as execute }`,
          `export default run`,
        ),
      ],
      [
        'again',
        lines(
          `export { execute as go } from './base'`,
          `export * from './base'`,
        ),
      ],
    )
    const run = helpers.get('base')?.get('run')
    expect(run?.spawns).toBe(true)
    expect(helpers.get('base')?.get('execute')).toBe(run)
    expect(helpers.get('base')?.get('default')).toBe(run)
    expect(helpers.get('again')?.get('go')).toBe(run)
    expect(helpers.get('again')?.get('execute')).toBe(run)
  })

  it('refuses a namespace re-exported by a helper', () => {
    expect(
      analyze(
        [
          'base',
          lines(
            `import { spawnSync } from 'node:child_process'`,
            `export function run() { return spawnSync('git', [], { timeout: 1_000 }) }`,
          ),
        ],
        [
          'barrel',
          lines(
            `export * as base from './base'`,
            `import * as again from './base'`,
            `export { again }`,
          ),
        ],
      ).problems,
    ).toEqual([
      'barrel.ts:1: export * as base: o guarda não segue um namespace re-exportado; exporte as funções pelo nome',
      'barrel.ts:3: export { again }: o guarda não segue um namespace re-exportado; exporte as funções pelo nome',
    ])
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
    // Importing a process function, and never using it or using it only
    // in a type, starts nothing.
    expect(audit(`import { TempRepo } from '../support/temp-repo'`)).toEqual([])
    expect(audit(`import { spawnSync } from 'node:child_process'`)).toEqual([])
    expect(
      audit(
        `import { runHook } from '../support/hooks'`,
        `type Runner = typeof runHook`,
      ),
    ).toEqual([])
    // A child_process call inside a string is a script for a child, not a
    // process this spec starts; a type-only import starts nothing either.
    expect(audit("const script = `require('node:child_process')`")).toEqual([])
    expect(
      audit(`import type { TempRepo } from '../support/temp-repo'`),
    ).toEqual([])
  })

  it('asks a spec that spawns for a case timeout, and only a real one', () => {
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `spawnSync('git', [], { timeout: 1_000 })`,
      ),
    ).toEqual([noCase('node:child_process')])
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

  it('reads a helper imported from a spec under src/', () => {
    expect(
      audit(
        `import { exec } from '../../test/support/temp-repo'`,
        `await exec('git')`,
      ),
    ).toEqual([untimedAt('x.spec.ts:2', 'exec'), noCase('exec')])
  })

  it('refuses an alias of a helper that starts a process, even one with a default', () => {
    expect(
      audit(
        `import { runHook } from '../support/hooks'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `const run = runHook`,
        `run('x', {}, { timeout: 180_000 })`,
      ),
    ).toEqual([indirectAt('x.spec.ts:3', 'runHook')])
  })

  it('reads the case timeout as vitest gets it: in order, through spreads', () => {
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `spawnSync('git', [], { timeout: 90_000 })`,
        `vi.setConfig({ testTimeout: 120_000, ...{ testTimeout: 1 } })`,
      ),
    ).toEqual([
      'x.spec.ts:3: o caso tem 1 ms, e o processo de x.spec.ts:2 tem 90000 ms: o caso precisa esperar mais que o processo',
    ])
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `spawnSync('git', [], { timeout: 90_000 })`,
        `vi.setConfig({ testTimeout: 120_000, ...extra })`,
      ),
    ).toEqual([
      // The opaque spread may replace hookTimeout as well.
      'x.spec.ts:3: testTimeout ...extra, que o guarda não lê como um número positivo: use um número ou um nome importado de test/support/hooks.ts',
      'x.spec.ts:3: hookTimeout ...extra, que o guarda não lê como um número positivo: use um número ou um nome importado de test/support/hooks.ts',
    ])
  })

  it('reads the options a helper gets from a const, and refuses ones it cannot read', () => {
    expect(
      audit(
        `import { runHook } from '../support/hooks'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `const options = { timeout: 180_000 }`,
        `runHook('x', {}, options)`,
        `runHook('x', {}, makeOptions())`,
        `runHook('x', {}, env === undefined ? {} : { env })`,
      ),
    ).toEqual([
      unreadAt('x.spec.ts:5', 'runHook', 'makeOptions()'),
      'x.spec.ts:2: o caso tem 120000 ms, e o processo de x.spec.ts:4 tem 180000 ms: o caso precisa esperar mais que o processo',
    ])
  })

  it('reads a helper through its export alias or its default export', () => {
    const aliased = analyzeSupport(
      [
        {
          name: 'base',
          file: 'base.ts',
          source: lines(
            `import { spawnSync } from 'node:child_process'`,
            `function run() { return spawnSync('git', [], { timeout: 60_000 }) }`,
            `export { run as execute }`,
            `export default run`,
          ),
        },
      ],
      names,
    ).helpers
    expect(
      auditSpec(
        'x.spec.ts',
        lines(
          `import { execute } from '../support/base'`,
          `import main from '../support/base'`,
          `execute()`,
          `main()`,
        ),
        aliased,
        names,
      ),
    ).toEqual([noCase('execute, main')])
  })

  it('takes only the vi of vitest', () => {
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `const vi = { setConfig: (_: object) => undefined }`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `spawnSync('git', [], { timeout: 1_000 })`,
      ),
    ).toEqual([noCase('node:child_process')])
    expect(
      audit(
        `import { vi } from 'vitest'`,
        `import { spawnSync } from 'node:child_process'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `spawnSync('git', [], { timeout: 1_000 })`,
      ),
    ).toEqual([])
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

  it('resolves a name in its own scope: a sibling declaration does not shadow it', () => {
    // The top-level spawnSync takes hooks.ts's 90 s spawnTimeout; the
    // 1 s one lives only inside other().
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `import { spawnTimeout } from '../support/hooks'`,
        `spawnSync('git', [], { timeout: spawnTimeout })`,
        `function other() { const spawnTimeout = 1_000; return spawnTimeout }`,
        `vi.setConfig({ testTimeout: 60_000 })`,
      ),
    ).toEqual([
      'x.spec.ts:5: o caso tem 60000 ms, e o processo de x.spec.ts:3 tem 90000 ms: o caso precisa esperar mais que o processo',
    ])
    // A local exec in another function does not hide the imported one.
    expect(
      audit(
        `import { exec } from '../support/temp-repo'`,
        `vi.setConfig({ testTimeout: 60_000 })`,
        `function local() { const exec = (x: string) => x; return exec('git') }`,
        `await exec('git')`,
      ),
    ).toEqual([untimedAt('x.spec.ts:4', 'exec')])
  })

  it('does not read a timeout from a parameter of a function of the spec', () => {
    // A caller can give run() any timeout: the default is not the one.
    expect(
      audit(
        `import { spawn } from 'node:child_process'`,
        `function run({ timeout = 90_000 } = {}) { return spawn('git', [], { timeout }) }`,
        `run({ timeout: 180_000 })`,
        `vi.setConfig({ testTimeout: 120_000 })`,
      ),
    ).toEqual([unreadAt('x.spec.ts:2', 'spawn', 'timeout')])
  })

  it('compares a process with the case or hook it runs in', () => {
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `it('short', () => { spawnSync('git', [], { timeout: 60_000 }) }, 5_000)`,
        `test('options', { timeout: 30_000 }, () => { spawnSync('git', [], { timeout: 60_000 }) })`,
        `it.each([1])('each %i', () => { spawnSync('git', [], { timeout: 60_000 }) })`,
        `beforeAll(() => { spawnSync('git', [], { timeout: 60_000 }) })`,
        `beforeEach(() => { spawnSync('git', [], { timeout: 60_000 }) }, 90_000)`,
      ),
    ).toEqual([
      'x.spec.ts:3: o caso tem 5000 ms, e o processo de x.spec.ts:3 tem 60000 ms: o caso precisa esperar mais que o processo',
      'x.spec.ts:4: o caso tem 30000 ms, e o processo de x.spec.ts:4 tem 60000 ms: o caso precisa esperar mais que o processo',
      // A hook with no timeout of its own has vitest's 10 s.
      'x.spec.ts:6: o hook tem 10000 ms, e o processo de x.spec.ts:6 tem 60000 ms: o hook precisa esperar mais que o processo',
    ])
    // hookTimeout in vi.setConfig covers the hooks with none of their own.
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })`,
        `beforeAll(() => { spawnSync('git', [], { timeout: 60_000 }) })`,
      ),
    ).toEqual([])
  })

  it('follows a function of the file to each case or hook that names or calls it', () => {
    expect(
      audit(
        `import { spawnSync } from 'node:child_process'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `function body() { spawnSync('git', [], { timeout: 60_000 }) }`,
        `it('named', body, 5_000)`,
        `it('called', () => { body() }, 30_000)`,
        `const setup = async () => { spawnSync('git', [], { timeout: 60_000 }) }`,
        `beforeAll(setup)`,
        `function idle() { spawnSync('git', [], { timeout: 60_000 }) }`,
      ),
    ).toEqual([
      'x.spec.ts:4: o caso tem 5000 ms, e o processo de x.spec.ts:3 tem 60000 ms: o caso precisa esperar mais que o processo',
      'x.spec.ts:5: o caso tem 30000 ms, e o processo de x.spec.ts:3 tem 60000 ms: o caso precisa esperar mais que o processo',
      'x.spec.ts:7: o hook tem 10000 ms, e o processo de x.spec.ts:6 tem 60000 ms: o hook precisa esperar mais que o processo',
    ])
  })

  it('reads the options of a case in order, and vitest through a namespace', () => {
    expect(
      audit(
        `import * as vitest from 'vitest'`,
        `import { spawnSync } from 'node:child_process'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `function body() { spawnSync('git', [], { timeout: 60_000 }) }`,
        `vitest.test('ns', body, 5_000)`,
        `vitest.test('spread', { timeout: 120_000, ...{ timeout: 5_000 } }, body)`,
        `const quick = { timeout: 5_000 }`,
        `vitest.it('const', quick, body)`,
        `vitest.it('opaque', { timeout: 120_000, ...extra }, body)`,
      ),
    ).toEqual([
      'x.spec.ts:9: o caso dá o timeout ...extra, que o guarda não lê como um número positivo: use um número ou um nome importado de test/support/hooks.ts',
      'x.spec.ts:5: o caso tem 5000 ms, e o processo de x.spec.ts:4 tem 60000 ms: o caso precisa esperar mais que o processo',
      'x.spec.ts:6: o caso tem 5000 ms, e o processo de x.spec.ts:4 tem 60000 ms: o caso precisa esperar mais que o processo',
      'x.spec.ts:8: o caso tem 5000 ms, e o processo de x.spec.ts:4 tem 60000 ms: o caso precisa esperar mais que o processo',
    ])
  })

  it('follows a function through an alias or an object method, and reads a fixture tuple', () => {
    expect(
      audit(
        `import { test as base } from 'vitest'`,
        `import { spawnSync } from 'node:child_process'`,
        `vi.setConfig({ testTimeout: 120_000 })`,
        `function body() { spawnSync('git', [], { timeout: 60_000 }) }`,
        `const alias = body`,
        `base('alias', alias, 5_000)`,
        `const helpers = { run() { spawnSync('git', [], { timeout: 60_000 }) } }`,
        `base('method', helpers.run, 5_000)`,
        `const test = base.extend<{ fresh: number }>({`,
        `  fresh: [async ({}, use) => { spawnSync('git', [], { timeout: 60_000 }); await use(1) }, { timeout: 30_000 }],`,
        `})`,
      ),
    ).toEqual([
      'x.spec.ts:6: o caso tem 5000 ms, e o processo de x.spec.ts:4 tem 60000 ms: o caso precisa esperar mais que o processo',
      'x.spec.ts:8: o caso tem 5000 ms, e o processo de x.spec.ts:7 tem 60000 ms: o caso precisa esperar mais que o processo',
      'x.spec.ts:9: o caso tem 30000 ms, e o processo de x.spec.ts:10 tem 60000 ms: o caso precisa esperar mais que o processo',
    ])
  })

  it('counts a fixture of test.extend in the case time', () => {
    expect(
      audit(
        `import { test as base } from 'vitest'`,
        `import { spawnSync } from 'node:child_process'`,
        `const test = base.extend<{ fresh: number }>({`,
        `  fresh: async ({}, use) => { spawnSync('git', [], { timeout: 60_000 }); await use(1) },`,
        `})`,
        `vi.setConfig({ testTimeout: 30_000 })`,
        `test('x', ({ fresh }) => { void fresh }, 90_000)`,
      ),
    ).toEqual([
      'x.spec.ts:6: o caso tem 30000 ms, e o processo de x.spec.ts:4 tem 60000 ms: o caso precisa esperar mais que o processo',
    ])
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
