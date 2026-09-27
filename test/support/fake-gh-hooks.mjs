// A strict stand-in for `gh`, for the live reads of the Claude Code hooks
// (#5), put first on PATH by test/support/hooks.ts and the hook specs.
//
// It answers exactly the calls githubClient makes (githubCalls in
// .claude/hooks/lib/gh-rules.mjs) and refuses any other argv with exit 97.
// The calls are copied here, not imported: a copy read from the hooks would
// bless any change to them, and a read that started asking another question
// would still pass against an answer shaped for the old one. Every call,
// answered or refused, is appended to FAKE_GH_LOG as one JSON line.
//
// FAKE_GH_FIXTURE names a JSON file:
//   {
//     repo?: 'owner/name',                 the only repository answered
//                                          (default geazioliveira/marketo-sandbox)
//     viewer?:  Answer & { login },
//     issues?:  { [number]: Answer & { labels: string[], labelsTotal?, lastCommentBody: string | null } },
//     threads?: { [id]: Answer & { lastAuthor: string | null } },
//     prs?:     { [number]: Answer & { pr: Pr } },
//     heads?:   { [branch]: Answer & { prs: Pr[] } },
//     comments?: { [number]: Answer & { comments: [{ body, createdAt, viewerDidAuthor }] } },
//     viewerIssues?: Answer & { issues: [{ number, createdAt, title, body, repo, labels: string[] }] },
//   }
//   Answer = { mode?: 'ok' | 'fail' | 'slow' }   ok by default; fail exits 1;
//            slow sleeps FAKE_GH_SLOW_MS (default 20000) before answering,
//            past any timeout the hooks use.
//   Pr = { number, state?, headRefOid, commitOid?, suites?, suitesTotal?,
//          reviews?, reviewsTotal?, requests?, requestsTotal?, threads?,
//          threadsTotal? }
//        suites: [{ workflow: string | null, runs: [{ name, status, conclusion, startedAt }], runsTotal? }]
//        reviews, requests: GraphQL nodes as they are; threads: [{ isResolved }]
//        Each *Total is the connection's totalCount (the list's length by default).
import { appendFileSync, readFileSync } from 'node:fs'

const argv = process.argv.slice(2)

const prFields =
  'number state headRefOid commits(last: 1) { nodes { commit { oid checkSuites(first: 100) { totalCount nodes { workflowRun { workflow { name } } checkRuns(first: 100, filterBy: { checkType: LATEST }) { totalCount nodes { name status conclusion startedAt } } } } } } } reviews(last: 100) { totalCount nodes { state submittedAt commit { oid } author { __typename login ... on Bot { databaseId } } body } } reviewRequests(first: 100) { totalCount nodes { requestedReviewer { __typename ... on Bot { databaseId } } } } reviewThreads(first: 100) { totalCount nodes { isResolved } }'

// The copy of githubCalls: each call is `api graphql`, its variables in this
// order (`-F` for number, `-f` for the rest), then `-f query=<query>`.
const calls = {
  viewer: { variables: [], query: 'query { viewer { login } }' },
  issueState: {
    variables: ['owner', 'name', 'number'],
    query:
      'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { labels(first: 100) { totalCount nodes { name } } comments(last: 1) { nodes { body } } } } }',
  },
  threadLastAuthor: {
    variables: ['id'],
    query:
      'query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { comments(last: 1) { nodes { author { login } } } } } }',
  },
  prByNumber: {
    variables: ['owner', 'name', 'number'],
    query: `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${prFields} } } }`,
  },
  prByHead: {
    variables: ['owner', 'name', 'head'],
    query: `query($owner: String!, $name: String!, $head: String!) { repository(owner: $owner, name: $name) { pullRequests(headRefName: $head, states: [OPEN], first: 2) { totalCount nodes { ${prFields} } } } }`,
  },
  issueComments: {
    variables: ['owner', 'name', 'number'],
    query:
      'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { comments(last: 100) { nodes { body createdAt viewerDidAuthor } } } } }',
  },
  viewerIssues: {
    variables: [],
    query:
      'query { viewer { issues(last: 20, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { number createdAt title body repository { nameWithOwner } labels(first: 100) { nodes { name } } } } } }',
  },
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

/** The call argv names, and its variables, or null. */
function match() {
  if (argv[0] !== 'api' || argv[1] !== 'graphql') return null
  const last = argv.at(-1) ?? ''
  if (argv.at(-2) !== '-f' || !last.startsWith('query=')) return null
  const query = last.slice('query='.length)
  const name = Object.keys(calls).find((key) => calls[key].query === query)
  if (name === undefined) return null
  const { variables } = calls[name]
  if (argv.length !== 4 + 2 * variables.length) return null
  const values = {}
  for (const [i, variable] of variables.entries()) {
    const flag = argv[2 + 2 * i]
    const pair = argv[3 + 2 * i]
    if (flag !== (variable === 'number' ? '-F' : '-f')) return null
    if (!pair.startsWith(`${variable}=`)) return null
    values[variable] = pair.slice(variable.length + 1)
  }
  if ('number' in values && !/^[1-9]\d*$/.test(values.number)) return null
  return { name, values }
}

const connection = (nodes, total) => ({
  totalCount: total ?? nodes.length,
  nodes,
})

function prNode(pr) {
  return {
    number: pr.number,
    state: pr.state ?? 'OPEN',
    headRefOid: pr.headRefOid,
    commits: {
      nodes: [
        {
          commit: {
            oid: pr.commitOid ?? pr.headRefOid,
            checkSuites: connection(
              (pr.suites ?? []).map((suite) => ({
                workflowRun:
                  suite.workflow === null
                    ? null
                    : { workflow: { name: suite.workflow } },
                checkRuns: connection(suite.runs ?? [], suite.runsTotal),
              })),
              pr.suitesTotal,
            ),
          },
        },
      ],
    },
    reviews: connection(pr.reviews ?? [], pr.reviewsTotal),
    reviewRequests: connection(pr.requests ?? [], pr.requestsTotal),
    reviewThreads: connection(pr.threads ?? [], pr.threadsTotal),
  }
}

/** The fixture entry a call is answered from, and the data it answers with. */
function answerFor(fixture, name, values) {
  if (name === 'viewer') {
    const entry = fixture.viewer
    return (
      entry && {
        key: 'viewer',
        entry,
        data: { viewer: { login: entry.login } },
      }
    )
  }
  if (name === 'issueState') {
    const entry = fixture.issues?.[values.number]
    return (
      entry && {
        key: values.number,
        entry,
        data: {
          repository: {
            issue: {
              labels: connection(
                (entry.labels ?? []).map((label) => ({ name: label })),
                entry.labelsTotal,
              ),
              comments: {
                nodes:
                  entry.lastCommentBody == null
                    ? []
                    : [{ body: entry.lastCommentBody }],
              },
            },
          },
        },
      }
    )
  }
  if (name === 'threadLastAuthor') {
    const entry = fixture.threads?.[values.id]
    return (
      entry && {
        key: values.id,
        entry,
        data: {
          node: {
            comments: {
              nodes: [
                {
                  author:
                    entry.lastAuthor === null
                      ? null
                      : { login: entry.lastAuthor },
                },
              ],
            },
          },
        },
      }
    )
  }
  if (name === 'prByNumber') {
    const entry = fixture.prs?.[values.number]
    return (
      entry && {
        key: values.number,
        entry,
        data: { repository: { pullRequest: prNode(entry.pr) } },
      }
    )
  }
  if (name === 'issueComments') {
    const entry = fixture.comments?.[values.number]
    return (
      entry && {
        key: values.number,
        entry,
        data: {
          repository: {
            issue: { comments: { nodes: entry.comments ?? [] } },
          },
        },
      }
    )
  }
  if (name === 'viewerIssues') {
    const entry = fixture.viewerIssues
    return (
      entry && {
        key: 'viewer',
        entry,
        data: {
          viewer: {
            issues: {
              nodes: (entry.issues ?? []).map((issue) => ({
                number: issue.number,
                createdAt: issue.createdAt,
                title: issue.title ?? '',
                body: issue.body ?? '',
                repository: { nameWithOwner: issue.repo },
                labels: {
                  nodes: (issue.labels ?? []).map((label) => ({ name: label })),
                },
              })),
            },
          },
        },
      }
    )
  }
  const entry = fixture.heads?.[values.head]
  return (
    entry && {
      key: values.head,
      entry,
      data: {
        repository: {
          pullRequests: {
            totalCount: (entry.prs ?? []).length,
            nodes: (entry.prs ?? []).slice(0, 2).map(prNode),
          },
        },
      },
    }
  )
}

async function main() {
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
  const call = match()
  if (call === null) return refuse(`argv inesperado: ${JSON.stringify(argv)}`)
  const { name, values } = call
  if ('owner' in values) {
    const repo = `${values.owner}/${values.name}`
    const expected = fixture.repo ?? 'geazioliveira/marketo-sandbox'
    if (repo !== expected)
      return refuse(`repositório inesperado: ${repo}, esperado ${expected}`)
  }
  const answer = answerFor(fixture, name, values)
  if (!answer)
    return refuse(`nenhuma resposta de ${name} para ${JSON.stringify(values)}`)
  const mode = answer.entry.mode ?? 'ok'
  record({ call: name, key: answer.key, mode })
  if (mode === 'fail') {
    process.stderr.write(
      'HTTP 502: Bad Gateway (https://api.github.com/graphql)\n',
    )
    process.exitCode = 1
    return
  }
  if (mode === 'slow')
    await new Promise((resolve) =>
      setTimeout(resolve, Number(process.env.FAKE_GH_SLOW_MS ?? 20_000)),
    )
  else if (mode !== 'ok') return refuse(`modo desconhecido: ${mode}`)
  process.stdout.write(`${JSON.stringify({ data: answer.data })}\n`)
}

await main()
