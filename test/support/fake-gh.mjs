// A strict stand-in for `gh`, put first on PATH by test/scripts/gate.spec.ts.
//
// It answers exactly the calls the gate makes and refuses anything else with
// exit 97. lite-campaign's fake answered every argv with the same JSON (#103),
// so a gate that started asking a different question, for a different issue,
// or of a different repository still passed its tests. Every call, accepted
// or refused, is appended to FAKE_GH_LOG, and the specs assert that log.
//
// It is strict about the GraphQL too. The query is parsed, and refused unless
// it selects every field the gate's verdict rests on (`required` below): with
// the real gh, a query that stopped asking for `lastEditedAt` would silently
// turn off the edit checks, and a fake that answered the whole fixture anyway
// would never notice. An `ok` answer is then cut down to what the query
// selected, so a gate reading a field it never asked for sees nothing, as it
// would on GitHub.
//
// Connections are paged as GitHub pages them: every field that selects
// `nodes` must ask for `first` or `last` (one of them, a literal from 1 to
// 100), and the answer holds only that many nodes, the first or the last ones
// of the fixture. A fixture may hold more nodes than a page, with the true
// `totalCount` beside them, so a gate that reads one page and judges it whole
// is caught.
//
// FAKE_GH_FIXTURE names a JSON file:
//   { owner, name, issue?: Answer, parent?: Answer, pr?: Answer }
//   parent answers a second issue query: the parent a slice of a stack (#31)
//   is judged by. An issue query is answered by whichever of issue and parent
//   has the number asked for.
//   Answer = { number, mode: 'ok' | 'missing' | 'auth' | 'unreachable', data? }
import { appendFileSync, readFileSync } from 'node:fs'

const argv = process.argv.slice(2)

// What the gate relies on, written as a GraphQL selection. Kept here, apart
// from scripts/gate.mjs: a copy read from the gate would bless any change to it.
const required = {
  issue: `{ repository { owner { login } issue {
    state body lastEditedAt
    parent { number repository { nameWithOwner } }
    labels { totalCount nodes { name } }
    comments { totalCount nodes { body createdAt lastEditedAt author { __typename login } } }
    timelineItems { totalCount nodes {
      __typename
      ... on LabeledEvent { createdAt actor { __typename login } label { name } }
      ... on ReopenedEvent { createdAt }
      ... on CommentDeletedEvent { createdAt }
    } }
    subIssues { totalCount nodes {
      number repository { nameWithOwner }
      labels { totalCount nodes { name } }
    } }
  } } }`,
  pr: `{ repository { pullRequest {
    baseRefName headRefName headRefOid isDraft body
    additions deletions changedFiles
    closingIssuesReferences { totalCount nodes { number repository { nameWithOwner } } }
    reviews { totalCount nodes {
      state submittedAt commit { oid }
      author { __typename login ... on Bot { databaseId } }
      body
    } }
    reviewRequests { totalCount nodes {
      requestedReviewer { __typename ... on Bot { databaseId } }
    } }
    reviewThreads { totalCount nodes {
      isResolved isOutdated path line
      comments { nodes { url author { login } } }
    } }
  } } }`,
}

/** Timeline item types the issue query must filter on, no more and no fewer. */
const itemTypes = ['LABELED_EVENT', 'REOPENED_EVENT', 'COMMENT_DELETED_EVENT']

// ---------------------------------------------------------------------------
// A small GraphQL reader: fields, arguments and inline fragments. Anything it
// does not know (aliases, named fragments, directives) is refused, never
// guessed at.

class QueryError extends Error {}

function tokenize(source) {
  const tokens = []
  const pattern =
    /[\s,]+|(\.\.\.|\$?[A-Za-z_][A-Za-z0-9_]*|-?\d+|"(?:[^"\\]|\\.)*"|[{}()[\]:!])/y
  while (pattern.lastIndex < source.length) {
    const at = pattern.lastIndex
    const matched = pattern.exec(source)
    if (matched === null)
      throw new QueryError(
        `caractere inesperado na query: ${source.slice(at, at + 20)}`,
      )
    if (matched[1] !== undefined) tokens.push(matched[1])
  }
  return tokens
}

/** Selection: { fields: Map<name, { args, selection | null }>, fragments: Map<type, Selection> } */
function parseQuery(source) {
  const tokens = tokenize(source)
  let i = 0
  const peek = () => tokens[i]
  const take = (expected) => {
    const token = tokens[i]
    if (expected !== undefined && token !== expected)
      throw new QueryError(`esperava "${expected}", achou "${token ?? 'fim'}"`)
    i += 1
    return token
  }
  const isName = (token) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(token ?? '')

  function value() {
    if (peek() === '[') {
      take('[')
      const list = []
      while (peek() !== ']') {
        if (peek() === undefined) throw new QueryError('lista sem "]"')
        list.push(value())
      }
      take(']')
      return list
    }
    const token = take()
    if (token === undefined || /^[{}()[\]:!]$/.test(token))
      throw new QueryError(`valor inesperado: ${token ?? 'fim'}`)
    return token
  }

  function args() {
    const found = {}
    take('(')
    while (peek() !== ')') {
      const name = take()
      if (!isName(name)) throw new QueryError(`argumento inesperado: ${name}`)
      take(':')
      found[name] = value()
    }
    take(')')
    return found
  }

  function selection() {
    const set = { fields: new Map(), fragments: new Map() }
    take('{')
    while (peek() !== '}') {
      const token = take()
      if (token === undefined) throw new QueryError('seleção sem "}"')
      if (token === '...') {
        take('on')
        const type = take()
        if (!isName(type)) throw new QueryError(`fragmento inesperado: ${type}`)
        set.fragments.set(type, merge(set.fragments.get(type), selection()))
        continue
      }
      if (!isName(token)) throw new QueryError(`campo inesperado: ${token}`)
      if (peek() === ':') throw new QueryError(`alias não suportado: ${token}`)
      const field = { args: peek() === '(' ? args() : {}, selection: null }
      if (peek() === '{') field.selection = selection()
      const before = set.fields.get(token)
      set.fields.set(
        token,
        before === undefined
          ? field
          : {
              args: field.args,
              selection: merge(before.selection, field.selection),
            },
      )
    }
    take('}')
    return set
  }

  // The operation: `query($owner: String!, …) { … }`, or a bare selection.
  if (peek() === 'query') {
    take('query')
    if (peek() === '(') {
      take('(')
      while (peek() !== ')') {
        if (take() === undefined) throw new QueryError('variáveis sem ")"')
      }
      take(')')
    }
  }
  const root = selection()
  if (i !== tokens.length)
    throw new QueryError(`sobra depois da query: ${tokens[i]}`)
  return root
}

function merge(a, b) {
  if (a == null) return b ?? null
  if (b == null) return a
  const out = { fields: new Map(a.fields), fragments: new Map(a.fragments) }
  for (const [name, field] of b.fields) {
    const before = out.fields.get(name)
    out.fields.set(
      name,
      before === undefined
        ? field
        : {
            args: field.args,
            selection: merge(before.selection, field.selection),
          },
    )
  }
  for (const [type, set] of b.fragments)
    out.fragments.set(type, merge(out.fragments.get(type), set))
  return out
}

/** Paths `need` selects that `have` does not. */
function missingFrom(have, need, at = []) {
  const missing = []
  for (const [name, field] of need.fields) {
    const found = have?.fields.get(name)
    if (found === undefined) missing.push([...at, name].join('.'))
    else if (field.selection !== null)
      missing.push(
        ...missingFrom(found.selection, field.selection, [...at, name]),
      )
  }
  for (const [type, set] of need.fragments) {
    const found = have?.fragments.get(type)
    if (found === undefined) missing.push([...at, `... on ${type}`].join('.'))
    else missing.push(...missingFrom(found, set, [...at, `... on ${type}`]))
  }
  return missing
}

/** The most nodes GitHub gives one page of a connection. */
const maxPage = 100

/**
 * How a query pages its connections, or the problems with it: a field that
 * selects `nodes` is a connection, and GitHub refuses one without `first` or
 * `last`, with both, or with a size outside 1 to 100.
 */
function pagingProblems(set, at = []) {
  if (set == null) return []
  const problems = []
  for (const [name, field] of set.fields) {
    const path = [...at, name].join('.')
    if (field.selection?.fields.has('nodes')) {
      const sizes = ['first', 'last'].filter((arg) => arg in field.args)
      if (sizes.length !== 1)
        problems.push(`${path} deve pedir first ou last, e só um deles`)
      for (const arg of sizes) {
        const size = field.args[arg]
        if (!/^[1-9]\d*$/.test(String(size)) || Number(size) > maxPage)
          problems.push(
            `${path}(${arg}: ${size}) deve ser um número de 1 a ${maxPage}`,
          )
      }
    }
    problems.push(...pagingProblems(field.selection, [...at, name]))
  }
  for (const [type, fragment] of set.fragments)
    problems.push(...pagingProblems(fragment, [...at, `... on ${type}`]))
  return problems
}

/** A connection's nodes cut to the page the field asked for (pagingProblems checked it). */
function paged(value, args) {
  if (value == null || !Array.isArray(value.nodes)) return value
  if ('first' in args)
    return { ...value, nodes: value.nodes.slice(0, Number(args.first)) }
  if ('last' in args)
    return { ...value, nodes: value.nodes.slice(-Number(args.last)) }
  return value
}

/** The answer cut down to what the query selected, as GitHub would send it. */
function prune(value, set) {
  if (value == null || set == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => prune(item, set))
  const fields = merge(
    { fields: set.fields, fragments: new Map() },
    set.fragments.get(value.__typename) ?? null,
  ).fields
  const out = {}
  for (const [name, field] of fields)
    if (name in value)
      out[name] = prune(paged(value[name], field.args), field.selection)
  return out
}

function record(entry) {
  if (process.env.FAKE_GH_LOG)
    appendFileSync(
      process.env.FAKE_GH_LOG,
      `${JSON.stringify({ argv, ...entry })}\n`,
    )
}

function refuse(violation) {
  record({ violation })
  process.stderr.write(`fake gh: ${violation}\n`)
  process.exitCode = 97
}

function answer() {
  let fixture
  try {
    fixture = JSON.parse(
      readFileSync(process.env.FAKE_GH_FIXTURE ?? '', 'utf8'),
    )
  } catch {
    return refuse('FAKE_GH_FIXTURE ausente ou ilegível')
  }
  if (
    process.env.GH_PROMPT_DISABLED !== '1' ||
    process.env.GH_NO_UPDATE_NOTIFIER !== '1'
  )
    return refuse(
      'GH_PROMPT_DISABLED=1 e GH_NO_UPDATE_NOTIFIER=1 são obrigatórios',
    )

  // The one shape: api graphql -F owner=… -F name=… -F number=… -f query=…
  const shape = [
    'api',
    'graphql',
    '-F',
    null,
    '-F',
    null,
    '-F',
    null,
    '-f',
    null,
  ]
  if (
    argv.length !== shape.length ||
    shape.some((token, i) => token !== null && argv[i] !== token)
  )
    return refuse(`argv inesperado: ${JSON.stringify(argv)}`)
  const [owner, name, number, query] = [argv[3], argv[5], argv[7], argv[9]]
  if (owner !== `owner=${fixture.owner}`)
    return refuse(`owner inesperado: ${owner}`)
  if (name !== `name=${fixture.name}`) return refuse(`name inesperado: ${name}`)
  if (!/^number=[1-9]\d*$/.test(number))
    return refuse(`number inesperado: ${number}`)
  if (
    !query.startsWith(
      'query=query($owner: String!, $name: String!, $number: Int!)',
    )
  )
    return refuse('query sem as variáveis owner, name e number')
  let tree
  try {
    tree = parseQuery(query.slice('query='.length))
  } catch (error) {
    if (error instanceof QueryError)
      return refuse(`query ilegível: ${error.message}`)
    throw error
  }
  const repository = tree.fields.get('repository')
  if (tree.fields.size !== 1 || repository?.selection == null)
    return refuse('query deve pedir só repository { … }')
  if (
    repository.args.owner !== '$owner' ||
    repository.args.name !== '$name' ||
    Object.keys(repository.args).length !== 2
  )
    return refuse('repository deve receber owner: $owner e name: $name')
  const asksIssue = repository.selection.fields.has('issue')
  const asksPr = repository.selection.fields.has('pullRequest')
  if (asksIssue === asksPr)
    return refuse('query deve pedir uma issue ou uma PR, e só uma')
  const kind = asksIssue ? 'issue' : 'pr'
  const target = repository.selection.fields.get(
    asksIssue ? 'issue' : 'pullRequest',
  )
  if (target.args.number !== '$number' || Object.keys(target.args).length !== 1)
    return refuse(`${kind} deve receber só number: $number`)
  const missing = missingFrom(tree, parseQuery(required[kind]))
  if (missing.length > 0)
    return refuse(`a query de ${kind} não pede: ${missing.join(', ')}`)
  const paging = pagingProblems(tree)
  if (paging.length > 0)
    return refuse(`a query de ${kind} pagina errado: ${paging.join('; ')}`)
  if (kind === 'issue') {
    const types =
      target.selection.fields.get('timelineItems')?.args.itemTypes ?? null
    if (
      !Array.isArray(types) ||
      types.length !== itemTypes.length ||
      !itemTypes.every((type) => types.includes(type))
    )
      return refuse(
        `timelineItems deve filtrar itemTypes: [${itemTypes.join(', ')}], recebeu ${JSON.stringify(types)}`,
      )
  }
  const answers = (
    kind === 'issue' ? [fixture.issue, fixture.parent] : [fixture.pr]
  ).filter((answer) => answer != null)
  if (answers.length === 0)
    return refuse(`nenhuma resposta de ${kind} neste caso`)
  const expected = answers.find(
    (answer) => number === `number=${answer.number}`,
  )
  if (expected === undefined)
    return refuse(
      `${kind} inesperada: ${number}, esperada ${answers.map((answer) => answer.number).join(' ou ')}`,
    )

  record({ kind, number: expected.number, mode: expected.mode })
  if (expected.mode === 'ok') {
    process.stdout.write(
      `${JSON.stringify({ data: prune(expected.data, tree) })}\n`,
    )
    return
  }
  process.exitCode = 1
  if (expected.mode === 'missing') {
    // gh's own output for an issue or PR that is not there.
    const type = kind === 'issue' ? 'Issue' : 'PullRequest'
    const field = kind === 'issue' ? 'issue' : 'pullRequest'
    const message = `Could not resolve to an ${type} with the number of ${expected.number}.`
    process.stdout.write(
      `${JSON.stringify({ data: { repository: { [field]: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', field], message }] })}\n`,
    )
    process.stderr.write(`gh: ${message}\n`)
  } else if (expected.mode === 'auth') {
    process.stderr.write(
      'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n',
    )
  } else if (expected.mode === 'unreachable') {
    process.stderr.write(
      'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n',
    )
  } else refuse(`modo desconhecido: ${expected.mode}`)
}

answer()
