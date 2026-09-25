// A strict stand-in for `gh`, put first on PATH by test/scripts/audit-main.spec.ts
// and test/scripts/refresh-issue-link.spec.ts.
//
// It is a fake of its own, apart from test/support/fake-gh.mjs: that one
// accepts only the gate's single GraphQL shape, and teaching it these calls
// would loosen the gate's tests.
//
// It answers exactly the calls scripts/audit-main.mjs and
// scripts/refresh-issue-link.mjs make, and refuses anything else with exit 97.
// Every call, accepted or refused, is appended to FAKE_GH_LOG with the time it
// was made (`at`, in ms), and the specs assert that log. Each call has a key,
// and FAKE_GH_FIXTURE answers by key:
//
//   audits          api repos/<repo>/actions/workflows/main-audit.yml/runs
//                     ?branch=main&status=completed&per_page=20
//   jobs:<id>       api repos/<repo>/actions/runs/<id>/jobs?filter=all&per_page=100
//   pulls:<sha>     api repos/<repo>/commits/<sha>/pulls?per_page=100
//   pr:<n>          api graphql -F owner=… -F name=… -F number=<n>
//                     -f head=<sha> -f query=<prQuery>
//                   answered with pr:<n> as the pullRequest and checks:<sha>
//                   as the head commit (null: no commit by that SHA)
//   issueRef:<n>    api repos/<repo>/issues/<n>
//   compare:<sha>   api repos/<repo>/compare/<sha>...<tip> (the last audited head)
//   search:<title>  issue list --repo <repo> --state all
//                     --search "<title>" in:title
//                     --json number,title,body,comments --limit 100
//   create:<title>  issue create --repo <repo> --title <title>
//                     --label bug --label needs-triage --body-file <file>
//   comment:<n>     issue comment <n> --repo <repo> --body-file <file>
//   issue:<n>       api graphql -F owner=… -F name=… -F number=<n> -f query=<issueQuery>
//   runs:<sha>      api repos/<repo>/actions/workflows/issue-link.yml/runs
//                     ?head_sha=<sha>&event=pull_request_target&per_page=1
//                   answered as GitHub filters: of the fixture's workflow_runs,
//                   the first of that event only
//   run:<id>        api repos/<repo>/actions/runs/<id>
//   rerun:<id>      api -X POST repos/<repo>/actions/runs/<id>/rerun
//
// A key the fixture does not hold is refused, so a script that asks about a
// commit, a PR, a title or a run the case did not expect fails the case.
// `sequences: { <key>: [first, second, …] }` answers the nth call of a key
// with the nth item, and every later call with the last one: the log is the
// state, so a run can be in progress and then finish, or a merge can be
// linked to its PR only on the second ask.
// `fail: { <key>: 'auth' | 'unreachable' | 'forbidden' | 'notFound' }` makes
// that call fail the way gh does.
//
// The GraphQL queries are compared whole, whitespace folded, with the ones
// written below, and each answer is cut down to what those queries select: a
// script that stopped asking for a field its verdict rests on must fail here,
// not read the field from the fixture anyway
// (context/knowledge/anti-patterns/test-double-strict-on-the-wrong-layer.md).
// They are written here, not read from the scripts: a copy taken from the
// script would bless any change to it. Each connection in an answer is also
// cut to the `first:` its query asks for, as GitHub cuts it, and a case whose
// fixture gives a connection no integer totalCount, or one below its own
// nodes, is refused: the scripts judge whether a page is the whole list by
// that count, so a case must not leave it out
// (scripts/audit-main.mjs, closingIssuesReferences).
//
// FAKE_GH_FIXTURE names a JSON file:
// { repo, answers: { <key>: … }, sequences?: { <key>: […] }, fail?: { <key>: mode } }
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const argv = process.argv.slice(2)

const queries = {
  pr: 'query($owner: String!, $name: String!, $number: Int!, $head: GitObjectID!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { number body closingIssuesReferences(first: 100) { totalCount nodes { number repository { nameWithOwner } } } } object(oid: $head) { ... on Commit { checkSuites(first: 100) { totalCount nodes { workflowRun { event file { path } workflow { name } } checkRuns(first: 100, filterBy: { checkType: ALL }) { totalCount nodes { name conclusion startedAt completedAt } } } } } } } }',
  issue:
    'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { closedByPullRequestsReferences(first: 10, includeClosedPrs: false) { totalCount nodes { number state headRefOid } } } } }',
}

/** What each query selects, for cutting an answer down to it. */
const selections = {
  pr: {
    number: true,
    body: true,
    closingIssuesReferences: {
      totalCount: true,
      nodes: { number: true, repository: { nameWithOwner: true } },
    },
  },
  commit: {
    checkSuites: {
      totalCount: true,
      nodes: {
        workflowRun: {
          event: true,
          file: { path: true },
          workflow: { name: true },
        },
        checkRuns: {
          totalCount: true,
          nodes: {
            name: true,
            conclusion: true,
            startedAt: true,
            completedAt: true,
          },
        },
      },
    },
  },
  issue: {
    closedByPullRequestsReferences: {
      totalCount: true,
      nodes: { number: true, state: true, headRefOid: true },
    },
  },
}

/** The page each connection of the queries above asks for, by field. */
const pageSizes = new Map(
  Object.values(queries).flatMap((query) =>
    [...query.matchAll(/(\w+)\(first: (\d+)/g)].map(([, field, first]) => [
      field,
      Number(first),
    ]),
  ),
)

const fold = (text) => String(text).replace(/\s+/g, ' ').trim()

/** Whether a selection reads a connection's count and nodes. */
const isConnection = (selection) =>
  selection !== true && selection.totalCount === true && 'nodes' in selection

/**
 * An answer holding only the selected fields, as GitHub would send it: each
 * connection keeps no more nodes than its page, and its totalCount.
 */
function prune(value, selection, field) {
  if (selection === true || value == null || typeof value !== 'object')
    return value
  if (Array.isArray(value)) return value.map((item) => prune(item, selection))
  const out = {}
  for (const [inner, sub] of Object.entries(selection))
    if (inner in value) out[inner] = prune(value[inner], sub, inner)
  const page = pageSizes.get(field)
  if (page !== undefined && Array.isArray(out.nodes))
    out.nodes = out.nodes.slice(0, page)
  return out
}

/**
 * The first connection in a fixture's answer without a count GitHub could
 * send (an integer, no fewer than the nodes given), by path; or null.
 */
function uncounted(value, selection, at) {
  if (selection === true || value == null || typeof value !== 'object')
    return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = uncounted(item, selection, at)
      if (found !== null) return found
    }
    return null
  }
  for (const [field, inner] of Object.entries(selection)) {
    const here = `${at}.${field}`
    const connection = value[field]
    if (isConnection(inner) && connection != null) {
      const nodes = Array.isArray(connection.nodes) ? connection.nodes : []
      if (
        !Number.isInteger(connection.totalCount) ||
        connection.totalCount < nodes.length
      )
        return here
    }
    const found = uncounted(connection, inner, here)
    if (found !== null) return found
  }
  return null
}

/** The calls already logged, before this one. */
function logged() {
  const log = process.env.FAKE_GH_LOG
  if (!log || !existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function record(entry) {
  if (process.env.FAKE_GH_LOG)
    appendFileSync(
      process.env.FAKE_GH_LOG,
      `${JSON.stringify({ argv, at: Date.now(), ...entry })}\n`,
    )
}

function refuse(violation) {
  record({ violation })
  process.stderr.write(`fake gh: ${violation}\n`)
  process.exitCode = 97
}

/** Matches argv against a shape: strings are exact, functions test the token. */
function matches(shape) {
  return (
    argv.length === shape.length &&
    shape.every((token, i) =>
      typeof token === 'function' ? token(argv[i]) : argv[i] === token,
    )
  )
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Which call this is, as { key, kind }, or the reason it is refused. */
function classify(repo) {
  const [owner, name] = repo.split('/')
  const any = () => true
  const at = escapeRegExp(repo)
  const rest = [
    [
      'audits',
      new RegExp(
        `^repos/${at}/actions/workflows/main-audit\\.yml/runs\\?branch=main&status=completed&per_page=20$`,
      ),
    ],
    [
      'pulls',
      new RegExp(`^repos/${at}/commits/([0-9a-f]{40})/pulls\\?per_page=100$`),
    ],
    [
      'jobs',
      new RegExp(
        `^repos/${at}/actions/runs/([1-9]\\d*)/jobs\\?filter=all&per_page=100$`,
      ),
    ],
    ['issueRef', new RegExp(`^repos/${at}/issues/([1-9]\\d*)$`)],
    [
      'compare',
      new RegExp(`^repos/${at}/compare/([0-9a-f]{40})\\.\\.\\.[0-9a-f]{40}$`),
    ],
    [
      'runs',
      new RegExp(
        `^repos/${at}/actions/workflows/issue-link\\.yml/runs\\?head_sha=([0-9a-f]{40})&event=pull_request_target&per_page=1$`,
      ),
    ],
    ['run', new RegExp(`^repos/${at}/actions/runs/([1-9]\\d*)$`)],
  ]
  const rerun = new RegExp(`^repos/${at}/actions/runs/([1-9]\\d*)/rerun$`)

  for (const [kind, pattern] of rest)
    if (matches(['api', (t) => pattern.test(t)])) {
      const id = pattern.exec(argv[1])[1]
      return { key: id === undefined ? kind : `${kind}:${id}`, kind: 'rest' }
    }
  if (matches(['api', '-X', 'POST', (t) => rerun.test(t)]))
    return { key: `rerun:${rerun.exec(argv[3])[1]}`, kind: 'rerun' }

  const graphql = ['api', 'graphql', '-F', any, '-F', any, '-F', any]
  const withHead = matches([...graphql, '-f', any, '-f', any])
  if (withHead || matches([...graphql, '-f', any])) {
    if (argv[3] !== `owner=${owner}`) return `owner inesperado: ${argv[3]}`
    if (argv[5] !== `name=${name}`) return `name inesperado: ${argv[5]}`
    const number = /^number=([1-9]\d*)$/.exec(argv[7])
    if (number === null) return `number inesperado: ${argv[7]}`
    const head = withHead ? /^head=([0-9a-f]{40})$/.exec(argv[9]) : null
    if (withHead && head === null) return `head inesperado: ${argv[9]}`
    const last = argv.at(-1)
    if (!last.startsWith('query=')) return 'o último argumento não é query='
    const query = fold(last.slice('query='.length))
    const kind = Object.keys(queries).find((k) => fold(queries[k]) === query)
    if (kind === undefined)
      return `query diferente das que o fake conhece: ${query}`
    if ((kind === 'pr') !== withHead)
      return `a query ${kind} ${withHead ? 'não leva' : 'precisa de'} head=`
    return {
      key: `${kind}:${number[1]}`,
      kind: `graphql-${kind}`,
      head: head?.[1],
    }
  }

  if (
    matches([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'all',
      '--search',
      (t) => /^".+" in:title$/.test(t),
      '--json',
      'number,title,body,comments',
      '--limit',
      '100',
    ])
  )
    return {
      key: `search:${/^"(.+)" in:title$/.exec(argv[7])[1]}`,
      kind: 'rest',
    }

  if (
    matches([
      'issue',
      'create',
      '--repo',
      repo,
      '--title',
      any,
      '--label',
      'bug',
      '--label',
      'needs-triage',
      '--body-file',
      any,
    ])
  )
    return { key: `create:${argv[5]}`, kind: 'create', bodyFile: argv[11] }

  if (
    matches([
      'issue',
      'comment',
      (t) => /^[1-9]\d*$/.test(t),
      '--repo',
      repo,
      '--body-file',
      any,
    ])
  )
    return { key: `comment:${argv[2]}`, kind: 'comment', bodyFile: argv[6] }

  return `argv inesperado: ${JSON.stringify(argv)}`
}

function fail(mode) {
  process.exitCode = 1
  if (mode === 'auth')
    process.stderr.write(
      'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n',
    )
  else if (mode === 'unreachable')
    process.stderr.write(
      'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n',
    )
  else if (mode === 'forbidden')
    process.stderr.write(
      'HTTP 403: Resource not accessible by integration (https://api.github.com/)\n',
    )
  else if (mode === 'notFound') {
    // Measured: gh prints GitHub's body on stdout and this line on stderr.
    process.stdout.write(
      '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}',
    )
    process.stderr.write('gh: Not Found (HTTP 404)\n')
  } else refuse(`modo de falha desconhecido: ${mode}`)
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
  // The workflows hand gh its token through GH_TOKEN; a script that dropped
  // the environment would leave gh with no credential on the runner.
  if (!process.env.GH_TOKEN) return refuse('GH_TOKEN ausente')

  const call = classify(String(fixture.repo))
  if (typeof call === 'string') return refuse(call)
  const { key, kind } = call

  let body
  if (call.bodyFile !== undefined) {
    if (!existsSync(call.bodyFile))
      return refuse(`--body-file inexistente: ${call.bodyFile}`)
    body = readFileSync(call.bodyFile, 'utf8')
  }
  const withBody = body === undefined ? {} : { body }
  const mode = fixture.fail?.[key]
  if (mode !== undefined) {
    record({ key, failed: mode, ...withBody })
    return fail(mode)
  }
  const answers = fixture.answers ?? {}
  const sequence = fixture.sequences?.[key]
  let value
  if (Array.isArray(sequence) && sequence.length > 0) {
    const seen = logged().filter(
      (entry) => entry.key === key && entry.failed === undefined,
    ).length
    value = sequence[Math.min(seen, sequence.length - 1)]
  } else if (key in answers) value = answers[key]
  else return refuse(`nenhuma resposta para ${key}`)

  const checks = `checks:${call.head}`
  if (kind === 'graphql-pr' && value !== null && !(checks in answers))
    return refuse(`nenhuma resposta para ${checks}`)
  const missing =
    kind === 'graphql-pr'
      ? (uncounted(value, selections.pr, 'pullRequest') ??
        uncounted(answers[checks], selections.commit, 'object'))
      : kind === 'graphql-issue'
        ? uncounted(value, selections.issue, 'issue')
        : null
  if (missing !== null)
    return refuse(
      `${key}: a fixture dá ${missing} sem um totalCount inteiro e não menor que os nodes`,
    )

  if (kind === 'graphql-pr') {
    record({ key, head: call.head })
    if (value === null) return notResolved('pullRequest', key)
    const commit = answers[checks]
    process.stdout.write(
      `${JSON.stringify({
        data: {
          repository: {
            pullRequest: prune(value, selections.pr),
            object: commit === null ? null : prune(commit, selections.commit),
          },
        },
      })}\n`,
    )
    return
  }
  record({ key, ...withBody })

  if (kind === 'rest') {
    process.stdout.write(
      `${JSON.stringify(key.startsWith('runs:') ? filtered(value) : value)}\n`,
    )
  } else if (kind === 'rerun') {
    // POST .../rerun answers 201 with no body; gh prints nothing.
    if (value !== true) refuse(`rerun não autorizado neste caso: ${key}`)
  } else if (kind === 'create') {
    if (!Number.isInteger(value))
      return refuse(`create sem número de issue: ${key}`)
    process.stdout.write(`https://github.com/${fixture.repo}/issues/${value}\n`)
  } else if (kind === 'comment') {
    if (value !== true) return refuse(`comentário não autorizado: ${key}`)
    process.stdout.write(
      `https://github.com/${fixture.repo}/issues/${argv[2]}#issuecomment-1\n`,
    )
  } else {
    if (value === null) return notResolved('issue', key)
    process.stdout.write(
      `${JSON.stringify({ data: { repository: { issue: prune(value, selections.issue) } } })}\n`,
    )
  }
}

/**
 * A runs listing as GitHub answers `event=pull_request_target&per_page=1`: the
 * newest run of that event, and the count of all of them.
 */
function filtered(listing) {
  if (!Array.isArray(listing?.workflow_runs)) return listing
  const runs = listing.workflow_runs.filter(
    (run) => run?.event === 'pull_request_target',
  )
  return {
    ...listing,
    total_count: runs.length,
    workflow_runs: runs.slice(0, 1),
  }
}

/** gh's own answer for a GraphQL number that is not there. */
function notResolved(field, key) {
  process.exitCode = 1
  const message = `Could not resolve to ${field === 'issue' ? 'an Issue' : 'a PullRequest'} with the number of ${key.split(':')[1]}.`
  process.stdout.write(
    `${JSON.stringify({ data: { repository: { [field]: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', field], message }] })}\n`,
  )
  process.stderr.write(`gh: ${message}\n`)
}

answer()
