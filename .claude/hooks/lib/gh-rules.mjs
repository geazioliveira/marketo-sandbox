// The rules for `gh` (#5), and the live GitHub reads some of them need.
//
// The agent posts from the owner's account, so GitHub cannot tell an Approve
// the agent wrote from one the owner wrote, nor a `ready-for-agent` the agent
// applied from the owner's (ownerRule). These rules stop the agent's side of
// that before gh runs: a comment that opens as an Approve, a withdrawal or a
// near miss; any write of a state label but the one post-plan transition; a
// pull request that closes no issue; a merge before the checks, the Copilot
// review and the threads are in order; a thread resolved with no reply.
//
// Three reads cannot be judged from the command alone, and ask GitHub live:
// the issue's labels and last comment (the label transition), the PR's checks,
// reviews and threads (the merge), and a thread's last author and the account
// (resolveReviewThread). Each is one `gh api graphql` call bounded by a
// timeout; a read that fails or is slow asks, never passes in silence.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  agentCreateStateLabels,
  agentPlanLabelTransition,
  branchShapes,
  closesLine,
  commentOpening,
  copilotRequested,
  copilotReviewOn,
  headAndRest,
  issueFromBranch,
  openThreads,
  parseBranch,
  readyLabel,
  requiredChecks,
  stateLabels,
} from '../../../scripts/loop-sections.mjs'
import { afterSpawn, spawnTimeout } from './budget.mjs'
import { readSource, skipTokenIn, wordKnown } from './git-rules.mjs'
import { ask, combine, deny, pass } from './io.mjs'
import {
  commandGitConfig,
  configuredRemote,
  isProject,
  projectRepo,
  repoFromArg,
  trunk,
} from './repo.mjs'
import { findOptions, parseCommand, readBody } from './shell.mjs'

// ---------------------------------------------------------------------------
// The live reads

/** The most nodes one GraphQL page may ask for. */
const page = 100

/**
 * What the merge rule reads of a PR: its head, the check runs of the head's
 * suites (the newest run per job in each suite), Copilot's reviews (the
 * newest page) and review requests, told apart by type and database id, and
 * whether each review thread is resolved.
 */
const prFields = `number state headRefOid commits(last: 1) { nodes { commit { oid checkSuites(first: ${page}) { totalCount nodes { workflowRun { workflow { name } } checkRuns(first: ${page}, filterBy: { checkType: LATEST }) { totalCount nodes { name status conclusion startedAt } } } } } } } reviews(last: ${page}) { totalCount nodes { state submittedAt commit { oid } author { __typename login ... on Bot { databaseId } } body } } reviewRequests(first: ${page}) { totalCount nodes { requestedReviewer { __typename ... on Bot { databaseId } } } } reviewThreads(first: ${page}) { totalCount nodes { isResolved } }`

/**
 * Every call githubClient makes, and the only ones: test/support/fake-gh-hooks.mjs
 * keeps a copy of this list and exits 97 on any other argv, so a read that
 * changes here without changing there fails its specs instead of passing
 * against an answer shaped for another question.
 *
 * Each call is `gh api graphql --hostname <host>`, then each variable in the
 * order listed, as `-f name=value` (a raw string; `-F name=value` for
 * `number`, an Int, whose value is always digits), then `-f query=<query>`.
 * `-F` is kept off the strings because it reads `@file` and converts `true`,
 * `null` and numbers. The host is the client's (githubClient), always
 * written out: gh api would otherwise take GH_HOST, or the one host gh is
 * logged in to, and read another GitHub than the one the command goes to.
 */
export const githubCalls = Object.freeze({
  viewer: Object.freeze({
    variables: [],
    query: 'query { viewer { login } }',
  }),
  issueState: Object.freeze({
    variables: ['owner', 'name', 'number'],
    query: `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { labels(first: ${page}) { totalCount nodes { name } } comments(last: 1) { nodes { body } } } } }`,
  }),
  threadLastAuthor: Object.freeze({
    variables: ['id'],
    query:
      'query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { comments(last: 1) { nodes { author { login } } } } } }',
  }),
  prByNumber: Object.freeze({
    variables: ['owner', 'name', 'number'],
    query: `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${prFields} } } }`,
  }),
  prByHead: Object.freeze({
    variables: ['owner', 'name', 'head'],
    query: `query($owner: String!, $name: String!, $head: String!) { repository(owner: $owner, name: $name) { pullRequests(headRefName: $head, states: [OPEN], first: 2) { totalCount nodes { ${prFields} } } } }`,
  }),
  // plan-to-issue, for a plan posted through Monitor or the terminal panel,
  // whose output is not gh's (Copilot review of #26): the issue's newest
  // comments, and the account's newest issues.
  issueComments: Object.freeze({
    variables: ['owner', 'name', 'number'],
    query: `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { comments(last: ${page}) { nodes { body createdAt viewerDidAuthor } } } } }`,
  }),
  viewerIssues: Object.freeze({
    variables: [],
    query: `query { viewer { issues(last: 20, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { number createdAt title body repository { nameWithOwner } labels(first: ${page}) { nodes { name } } } } } }`,
  }),
})

/** The host every live read goes to unless told otherwise: this project's. */
const projectHost = 'github.com'

/** The argv of one githubCalls entry with its variables' values, on `host`. */
export function githubCallArgv(name, values = {}, host = projectHost) {
  const call = githubCalls[name]
  const args = ['api', 'graphql', '--hostname', host]
  for (const variable of call.variables)
    args.push(
      variable === 'number' ? '-F' : '-f',
      `${variable}=${values[variable]}`,
    )
  args.push('-f', `query=${call.query}`)
  return args
}

const defaultTimeoutMs = 6000
const ok = (value) => ({ ok: true, value })
const failed = (reason) => ({ ok: false, reason })
const firstLine = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? ''
const short = (sha) => String(sha ?? '').slice(0, 7)

function timeoutOf(env, timeoutMs) {
  if (Number.isInteger(timeoutMs) && timeoutMs > 0) return timeoutMs
  const fromEnv = Number(env?.LOOP_HOOKS_GH_TIMEOUT_MS)
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : defaultTimeoutMs
}

function splitRepo(repo) {
  const [owner = '', name = ''] = String(repo ?? '').split('/')
  return { owner, name }
}

/**
 * A connection's nodes, noting in `unread` when GitHub holds more than the
 * page read, or sent no list at all: a verdict on part of a list is no
 * verdict.
 */
function nodesOf(connection, what, unread) {
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : null
  if (nodes === null || typeof connection.totalCount !== 'number') {
    unread.push(what)
    return nodes ?? []
  }
  if (connection.totalCount > nodes.length) unread.push(what)
  return nodes
}

const checkLabel = ({ workflow, job }) => `${workflow} / ${job}`

/**
 * Whether each of requiredChecks concluded SUCCESS on the head, matched by
 * workflow name and job name. Of a job's runs across the head's suites, the
 * newest counts; a run not started yet (no startedAt) is the newest, since
 * it will finish after every run that started.
 */
function checksOn(commit, unread) {
  const suites = nodesOf(commit?.checkSuites, 'check suites da cabeça', unread)
  const problems = []
  for (const check of requiredChecks) {
    const runs = suites
      .filter((suite) => suite?.workflowRun?.workflow?.name === check.workflow)
      .flatMap((suite) =>
        nodesOf(suite.checkRuns, `check runs de ${check.workflow}`, unread),
      )
      .filter((run) => run?.name === check.job)
    if (runs.length === 0) {
      problems.push(`${checkLabel(check)} ausente na cabeça`)
      continue
    }
    const started = (run) => {
      const at = Date.parse(String(run.startedAt ?? ''))
      return Number.isNaN(at) ? Infinity : at
    }
    const newest = Math.max(...runs.map(started))
    const bad = runs
      .filter((run) => started(run) === newest)
      .find((run) => run.status !== 'COMPLETED' || run.conclusion !== 'SUCCESS')
    if (bad !== undefined)
      problems.push(
        bad.status !== 'COMPLETED'
          ? `${checkLabel(check)} ainda não concluído (${bad.status ?? 'sem status'})`
          : `${checkLabel(check)} concluído com ${bad.conclusion ?? 'nenhuma conclusão'}`,
      )
  }
  return {
    checksOk: problems.length === 0,
    checksDetail:
      problems.length === 0
        ? `${requiredChecks.map(checkLabel).join(' e ')} verdes`
        : problems.join('; '),
  }
}

function mergeStateOf(pr) {
  const headRefOid = typeof pr?.headRefOid === 'string' ? pr.headRefOid : ''
  if (headRefOid === '') return failed('o GitHub não deu a cabeça da PR')
  const commit = pr.commits?.nodes?.[0]?.commit
  if (commit?.oid !== headRefOid)
    return failed(
      `o último commit lido (${short(commit?.oid) || 'nenhum'}) não é a cabeça ${short(headRefOid)}`,
    )
  const unread = []
  const checks = checksOn(commit, unread)
  const review = copilotReviewOn({
    reviews: nodesOf(pr.reviews, 'revisões', unread),
    headRefOid,
  })
  const requested = copilotRequested(
    nodesOf(pr.reviewRequests, 'pedidos de revisão', unread),
  )
  const threads = openThreads(
    nodesOf(pr.reviewThreads, 'threads de revisão', unread),
  )
  const missing = [...new Set(unread)]
  return ok({
    number: pr.number,
    state: pr.state ?? null,
    headRefOid,
    ...checks,
    review,
    requested,
    openThreads: threads,
    pagesComplete: missing.length === 0,
    unread: missing,
  })
}

/**
 * Live reads through `gh`, each bounded by a timeout (default 6000 ms, env
 * LOOP_HOOKS_GH_TIMEOUT_MS) and by the run's budget (budget.mjs). Each returns
 * { ok: true, value } or { ok: false, reason }; the only throw is
 * BudgetExhausted, which ends the whole run. gh runs through argv
 * (spawnSync), never a shell, with its prompts and update notice off.
 *
 * A client reads one host, `host` (github.com by default), and nothing else
 * (Copilot review of #26, fifth round): the reads that judge a command must
 * come from the GitHub the command goes to, and the hook's own environment
 * may name another one. So every call carries `--hostname <host>`, gh runs
 * with GH_HOST set to it, and GH_REPO is dropped: each query names its
 * repository in its variables, and no inherited default may stand in. The
 * token is the one gh picks for that host: GH_TOKEN or GITHUB_TOKEN, else
 * the login stored for it, on github.com; GH_ENTERPRISE_TOKEN or
 * GITHUB_ENTERPRISE_TOKEN only on another host. An enterprise token the
 * hook inherits never authenticates a read of github.com.
 *   .viewer()                   -> login
 *   .issueState(repo, number)   -> { labels, labelsComplete, lastCommentBody }
 *   .threadLastAuthor(threadId) -> login | null
 *   .prMergeState(repo, prRef)  -> { number, state, headRefOid, checksOk,
 *                                    checksDetail, review, requested,
 *                                    openThreads, pagesComplete, unread }
 *   .issueComments(repo, number) -> [{ body, createdAt, viewerDidAuthor }],
 *                                   the newest page
 *   .viewerIssues()             -> [{ number, createdAt, title, body, repo,
 *                                    labels }], the account's 20 newest
 * prRef is a PR number, or a branch whose one open PR is read.
 */
export function githubClient({
  env = process.env,
  timeoutMs,
  host = projectHost,
} = {}) {
  const limit = timeoutOf(env, timeoutMs)
  const readHost = String(host).trim().toLowerCase()
  const ghEnv = {
    ...env,
    GH_HOST: readHost,
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
  }
  delete ghEnv.GH_REPO

  function graphql(name, values) {
    // The run's budget (budget.mjs) bounds the read too; when it runs out,
    // the hook answers for the whole run instead of reading a killed gh as a
    // failure of this one read.
    const step = 'ler o GitHub'
    const timeout = spawnTimeout(limit, step)
    let run
    try {
      run = spawnSync('gh', githubCallArgv(name, values, readHost), {
        encoding: 'utf8',
        env: ghEnv,
        timeout,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      return failed(`gh não pôde rodar: ${error.message}`)
    }
    afterSpawn(run, limit, timeout, step)
    if (run.error?.code === 'ENOENT')
      return failed('gh não está instalado ou não está no PATH')
    if (run.error?.code === 'ETIMEDOUT' || run.signal !== null)
      return failed(`gh não respondeu em ${limit} ms`)
    if (run.error) return failed(`gh falhou: ${run.error.message}`)
    let payload = null
    try {
      payload = JSON.parse(run.stdout)
    } catch {
      payload = null
    }
    const errors = Array.isArray(payload?.errors) ? payload.errors : []
    if (run.status === 0 && errors.length === 0 && payload?.data != null)
      return ok(payload.data)
    return failed(
      firstLine(run.stderr) ||
        firstLine(errors[0]?.message) ||
        `gh saiu com status ${run.status}`,
    )
  }

  return {
    viewer() {
      const read = graphql('viewer', {})
      if (!read.ok) return read
      const login = read.value?.viewer?.login
      return typeof login === 'string' && login !== ''
        ? ok(login)
        : failed('o GitHub não disse qual é a conta do gh')
    },

    issueState(repo, number) {
      if (!Number.isInteger(Number(number)) || Number(number) < 1)
        return failed(`"${number}" não é número de issue`)
      const read = graphql('issueState', {
        ...splitRepo(repo),
        number: Number(number),
      })
      if (!read.ok) return read
      const issue = read.value?.repository?.issue
      if (issue == null) return failed(`a issue #${number} não foi encontrada`)
      const nodes = Array.isArray(issue.labels?.nodes) ? issue.labels.nodes : []
      const labels = nodes
        .map((node) => node?.name)
        .filter((name) => typeof name === 'string')
      const comments = Array.isArray(issue.comments?.nodes)
        ? issue.comments.nodes
        : []
      const last = comments.at(-1)
      return ok({
        labels,
        labelsComplete:
          typeof issue.labels?.totalCount === 'number' &&
          issue.labels.totalCount <= labels.length,
        lastCommentBody: typeof last?.body === 'string' ? last.body : null,
      })
    },

    threadLastAuthor(threadId) {
      const read = graphql('threadLastAuthor', { id: threadId })
      if (!read.ok) return read
      const comments = read.value?.node?.comments?.nodes
      if (!Array.isArray(comments))
        return failed(`a thread ${threadId} não foi encontrada`)
      const login = comments.at(-1)?.author?.login
      return ok(typeof login === 'string' ? login : null)
    },

    prMergeState(repo, prRef) {
      const byNumber = /^[1-9]\d*$/.test(String(prRef))
      const read = byNumber
        ? graphql('prByNumber', { ...splitRepo(repo), number: Number(prRef) })
        : graphql('prByHead', { ...splitRepo(repo), head: String(prRef) })
      if (!read.ok) return read
      if (byNumber) {
        const pr = read.value?.repository?.pullRequest
        return pr == null
          ? failed(`a PR #${prRef} não foi encontrada`)
          : mergeStateOf(pr)
      }
      const list = read.value?.repository?.pullRequests
      const nodes = Array.isArray(list?.nodes) ? list.nodes : []
      if (nodes.length === 0)
        return failed(`nenhuma PR aberta sai da branch ${prRef}`)
      if (nodes.length > 1 || Number(list?.totalCount) > 1)
        return failed(`mais de uma PR aberta sai da branch ${prRef}`)
      return mergeStateOf(nodes[0])
    },

    issueComments(repo, number) {
      if (!Number.isInteger(Number(number)) || Number(number) < 1)
        return failed(`"${number}" não é número de issue`)
      const read = graphql('issueComments', {
        ...splitRepo(repo),
        number: Number(number),
      })
      if (!read.ok) return read
      const issue = read.value?.repository?.issue
      if (issue == null) return failed(`a issue #${number} não foi encontrada`)
      const nodes = issue.comments?.nodes
      if (!Array.isArray(nodes))
        return failed(`o GitHub não deu os comentários da issue #${number}`)
      return ok(
        nodes
          .filter((node) => node !== null && typeof node === 'object')
          .map((node) => ({
            body: typeof node.body === 'string' ? node.body : '',
            createdAt: String(node.createdAt ?? ''),
            viewerDidAuthor: node.viewerDidAuthor === true,
          })),
      )
    },

    viewerIssues() {
      const read = graphql('viewerIssues', {})
      if (!read.ok) return read
      const nodes = read.value?.viewer?.issues?.nodes
      if (!Array.isArray(nodes))
        return failed('o GitHub não deu as issues da conta do gh')
      return ok(
        nodes
          .filter((node) => node !== null && typeof node === 'object')
          .map((node) => ({
            number: Number(node.number),
            createdAt: String(node.createdAt ?? ''),
            title: typeof node.title === 'string' ? node.title : '',
            body: typeof node.body === 'string' ? node.body : '',
            repo: String(node.repository?.nameWithOwner ?? '').toLowerCase(),
            labels: (Array.isArray(node.labels?.nodes) ? node.labels.nodes : [])
              .map((label) => label?.name)
              .filter((name) => typeof name === 'string'),
          })),
      )
    },
  }
}

/**
 * One client per host, made when first asked for: what guard-bash and
 * plan-to-issue hand the rules as `githubFor`, so each command's reads go to
 * its own host (Copilot review of #26, fifth round).
 */
export function githubClients({ env = process.env, timeoutMs } = {}) {
  const clients = new Map()
  return (host) => {
    const key = String(host).trim().toLowerCase()
    if (!clients.has(key))
      clients.set(key, githubClient({ env, timeoutMs, host: key }))
    return clients.get(key)
  }
}

/** A client that reads nothing, every read failing with `reason`. */
const noReads = (reason) => ({
  viewer: () => failed(reason),
  issueState: () => failed(reason),
  threadLastAuthor: () => failed(reason),
  prMergeState: () => failed(reason),
  issueComments: () => failed(reason),
  viewerIssues: () => failed(reason),
})

/** An alias is judged as written, never live. */
const offline = noReads('um alias não é lido ao vivo')

/**
 * The client of a command whose host cannot be read (GH_HOST or --hostname
 * with an expansion): it may be github.com or another GitHub, and a read of
 * either could judge the command by the wrong one. Nothing is read, and the
 * rule that needed the read asks, critical, as for a read that failed.
 */
const unaligned = noReads(
  'não consegui ler em que GitHub o comando roda, GH_HOST ou --hostname com uma expansão, e nada foi lido',
)

/**
 * The client for the host a command's reads go to (Copilot review of #26,
 * fifth round), or `unaligned` for a host that cannot be read (null).
 * ctx.githubFor(host) when given (guard-bash; an alias being defined gets
 * one that reads nothing), else ctx.github as it is (a spec's stub), else a
 * new client for the host.
 */
function clientAt(ctx, host) {
  if (host === null) return unaligned
  if (typeof ctx.githubFor === 'function') return ctx.githubFor(host)
  return ctx.github ?? githubClient({ host })
}

/**
 * `base` with `extra` over it, keeping getters as getters: guard-bash gives
 * ctx.repo as a getter, so the git calls behind it run only for a rule that
 * reads it, and a spread would run them for every command.
 */
function extend(base, extra) {
  return Object.defineProperties(
    {},
    {
      ...Object.getOwnPropertyDescriptors(base ?? {}),
      ...Object.getOwnPropertyDescriptors(extra),
    },
  )
}

// ---------------------------------------------------------------------------
// Words of a gh command

/** Options that take a separate value, per subcommand (`-R/--repo` for all). */
const valuedFlags = {
  'issue comment': ['-b', '--body', '-F', '--body-file'],
  'issue create': [
    '-a',
    '--assignee',
    '-b',
    '--body',
    '-F',
    '--body-file',
    '-l',
    '--label',
    '-m',
    '--milestone',
    '-p',
    '--project',
    '-T',
    '--template',
    '-t',
    '--title',
    '--recover',
  ],
  'issue edit': [
    '--add-assignee',
    '--add-label',
    '--add-project',
    '-b',
    '--body',
    '-F',
    '--body-file',
    '-m',
    '--milestone',
    '--remove-assignee',
    '--remove-label',
    '--remove-project',
    '-t',
    '--title',
  ],
  'issue reopen': ['-c', '--comment'],
  'issue close': ['-c', '--comment', '-r', '--reason'],
  'label create': ['-c', '--color', '-d', '--description'],
  'label edit': ['-c', '--color', '-d', '--description', '-n', '--name'],
  'label delete': [],
  'repo edit': [],
  'pr create': [
    '-a',
    '--assignee',
    '-B',
    '--base',
    '-b',
    '--body',
    '-F',
    '--body-file',
    '-H',
    '--head',
    '-l',
    '--label',
    '-m',
    '--milestone',
    '-p',
    '--project',
    '--recover',
    '-r',
    '--reviewer',
    '-T',
    '--template',
    '-t',
    '--title',
  ],
  'pr edit': [
    '--add-assignee',
    '--add-label',
    '--add-project',
    '--add-reviewer',
    '-B',
    '--base',
    '-b',
    '--body',
    '-F',
    '--body-file',
    '-m',
    '--milestone',
    '--remove-assignee',
    '--remove-label',
    '--remove-project',
    '--remove-reviewer',
    '-t',
    '--title',
  ],
  'pr merge': [
    '-A',
    '--author-email',
    '-b',
    '--body',
    '-F',
    '--body-file',
    '--match-head-commit',
    '-t',
    '--subject',
  ],
  'alias set': [],
  api: [
    '-X',
    '--method',
    '-f',
    '--raw-field',
    '-F',
    '--field',
    '-H',
    '--header',
    '--input',
    '-q',
    '--jq',
    '-t',
    '--template',
    '--cache',
    '--hostname',
    '-p',
    '--preview',
  ],
}

/** gh's built-in aliases of the verbs judged here. */
const verbAliases = new Map([['new', 'create']])

/**
 * The operands of a gh command from `from` on: every word that is no option
 * nor an option's value, with whether it holds an expansion.
 */
function operandsOf(command, from, valued) {
  const argv = command.argv.map(String)
  const flags = new Set([...valued, '-R', '--repo'])
  const operands = []
  for (let k = from; k < argv.length; k += 1) {
    const arg = argv[k]
    if (arg === '--') {
      for (let j = k + 1; j < argv.length; j += 1)
        operands.push({
          value: argv[j],
          index: j,
          known: wordKnown(command, j),
        })
      break
    }
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && flags.has(arg)) k += 1
      continue
    }
    if (arg.startsWith('-') && arg.length > 1) {
      if (arg.length === 2 && flags.has(arg)) k += 1
      continue
    }
    operands.push({ value: arg, index: k, known: wordKnown(command, k) })
  }
  return operands
}

/** Whether a boolean option is on the command line, before any `--`. */
function hasFlag(command, names) {
  const argv = command.argv.map(String)
  const end = argv.indexOf('--')
  return argv.some(
    (arg, index) => (end < 0 || index < end) && names.includes(arg),
  )
}

/** Every value of the options, with whether each holds an expansion. */
function optionWords(command, names) {
  return findOptions(command.argv.map(String), names).map((option) => ({
    value: option.value,
    known: wordKnown(command, option.index),
  }))
}

const githubUrl =
  /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/(issues|pull)\/([1-9]\d*)(?:[/?#].*)?$/i

/** An issue or PR operand: `5`, `#5` or a GitHub URL, or null. */
function refOf(operand) {
  if (!operand?.known) return null
  const bare = /^#?([1-9]\d*)$/.exec(operand.value)
  if (bare) return { number: Number(bare[1]), repo: null }
  const url = githubUrl.exec(operand.value)
  if (url)
    return {
      number: Number(url[4]),
      repo: `${url[1]}/${url[2]}`.toLowerCase(),
    }
  return null
}

/**
 * The environment a gh command runs with: what it inherits (ctx.env, which
 * guard-bash sets to its own, with the line's exports) and its own
 * assignments over it.
 */
const envOf = (command, ctx) => ({ ...ctx.env, ...command.env })

/**
 * Whether the directory the command runs in, and so the repository around
 * it, is the one ctx.repo describes: not when it came from a `cd` the parser
 * could not read, or an earlier command of the line made it (guard-bash).
 */
const directoryKnown = (ctx) =>
  ctx.cwdKnown !== false && ctx.repo?.repoKnown !== false

/**
 * Whether ctx.repo.repo is the repository gh picks from the remotes: not
 * when an earlier command of the line changed them in a way guard-bash
 * cannot follow (remoteKnown false; Copilot review of #26).
 */
const remotesKnown = (ctx) =>
  directoryKnown(ctx) && ctx.repo?.remoteKnown !== false

/**
 * The branch checked out where the command runs, and whether it is known:
 * not when the directory is not, or an earlier command of the line moved
 * HEAD (guard-bash sets branchKnown: false).
 */
const branchOf = (ctx) => ({
  known: directoryKnown(ctx) && ctx.repo?.branchKnown !== false,
  value: ctx.repo?.branch ?? null,
})

/**
 * A host as gh compares it: lowercased, and any `*.github.com` (the API's
 * `api.github.com`, `www.github.com`) is github.com, as gh normalizes it.
 */
const normalHost = (host) => {
  const folded = String(host).trim().toLowerCase()
  return folded === 'github.com' || folded.endsWith('.github.com')
    ? 'github.com'
    : folded
}

/**
 * The host gh falls back on for a repository named without one (`-R
 * OWNER/REPO`, GH_REPO, the remotes): GH_HOST as the command sees it (set on
 * the command, exported earlier on the line, or inherited), else github.com.
 * { host: null, unknown: true } when it holds an expansion: it may be this
 * one or not (Copilot review of #26).
 */
function defaultHost(command, ctx) {
  const value = envOf(command, ctx).GH_HOST
  if (typeof value !== 'string' || value.trim() === '')
    return { host: 'github.com', unknown: false }
  if (/[$`]/.test(value)) return { host: null, unknown: true }
  return { host: normalHost(value), unknown: false }
}

/**
 * The repository `-R` or GH_REPO names, as gh parses it: `OWNER/REPO` on
 * the default host, `HOST/OWNER/REPO`, or a URL (`scheme://` or the scp form
 * `git@host:`). A host other than github.com is another GitHub, never this
 * project, and `host` names it; a default host that cannot be read leaves
 * the target unknown.
 * @returns {{ repo: string | null, unknown: boolean, host?: string }}
 */
function namedTarget(value, host) {
  const text = String(value).trim()
  const url =
    /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.*)$/i.exec(text) ??
    /^git@([^/:]+):(.*)$/i.exec(text)
  const parts = (url ? url[2] : text).replace(/\/+$/, '').split('/')
  let named = url ? url[1] : null
  if (!url && parts.length === 3) named = parts.shift()
  if (parts.length !== 2) return { repo: repoFromArg(text), unknown: false }
  const on = named === null ? host : { host: normalHost(named), unknown: false }
  if (on.unknown) return { repo: null, unknown: true }
  if (on.host !== 'github.com')
    return { repo: null, unknown: false, host: on.host }
  const name = parts[1].replace(/\.git$/i, url ? '' : '$&')
  return { repo: repoFromArg(`${parts[0]}/${name}`), unknown: false }
}

/** GH_REPO as the command sees it: { repo, unknown }, or null when unset. */
function ghRepoEnv(command, ctx) {
  const value = envOf(command, ctx).GH_REPO
  if (typeof value !== 'string' || value === '') return null
  return /[$`]/.test(value)
    ? { repo: null, unknown: true }
    : namedTarget(value, defaultHost(command, ctx))
}

/**
 * The directory gh finds its repository from: gh asks git, so a GIT_DIR the
 * command sees (on the command, exported earlier on the line, or inherited)
 * moves it, relative to the command's directory. GIT_WORK_TREE does not:
 * git reads the remotes of the repository GIT_DIR names, or of the one
 * around the directory, whatever the work tree (measured on git 2.50, and
 * gh 2.101 posts to the repository GIT_DIR names; Copilot review of #26,
 * sixth round). guard-bash judges a gh command there, and plan-to-issue
 * reads there where a publication goes. `known` is false when GIT_DIR holds
 * an expansion; `gitDir` is the value, null when unset.
 * @returns {{ dir: string, known: boolean, gitDir: string | null }}
 */
export function ghRepoDir(env, cwd) {
  const gitDir = env?.GIT_DIR
  if (typeof gitDir !== 'string' || gitDir === '')
    return { dir: cwd, known: true, gitDir: null }
  if (/[$`]/.test(gitDir)) return { dir: cwd, known: false, gitDir }
  return { dir: path.resolve(cwd, gitDir), known: true, gitDir }
}

/**
 * The repository a gh command acts on, as gh picks it: the repository of a
 * URL operand, else the last `-R/--repo`, else GH_REPO (set on the command,
 * exported earlier on the line, or inherited), else the repository around
 * the command's directory. A repository named without a host, and the
 * remotes, are on GH_HOST when it is set: another host is another GitHub,
 * never this project (Copilot review of #26), and `host` names it. A value
 * that holds an expansion, a directory that could not be read, or a GH_HOST
 * that could not be read may be this project: the target is then unknown,
 * judged as this project for a refusal and never for a pass. The remotes
 * are read with the git config the command gives git (remotesRepo; seventh
 * round), and `why` says why they could not be.
 *
 * plan-to-issue reads a publication's target here too (fourth round), with
 * ctx = { env, repo, cwdKnown, cwd } of the place its gh runs.
 * @returns {{ repo: string | null, unknown: boolean, host?: string }}
 */
export function targetOf(command, ctx, operands = []) {
  const fromUrl = operands.map(refOf).find((ref) => ref?.repo)
  if (fromUrl) return { repo: fromUrl.repo, unknown: false }
  const host = defaultHost(command, ctx)
  const flags = findOptions(command.argv.map(String), ['-R', '--repo'])
  if (flags.length > 0) {
    const last = flags.at(-1)
    if (!wordKnown(command, last.index)) return { repo: null, unknown: true }
    return namedTarget(last.value, host)
  }
  const env = ghRepoEnv(command, ctx)
  if (env !== null) return env
  // gh keeps only the remotes on GH_HOST when it is set: on another host,
  // none of them is this project's (or gh refuses to run).
  if (host.unknown) return { repo: null, unknown: true }
  if (host.host !== 'github.com')
    return { repo: null, unknown: false, host: host.host }
  return remotesRepo(command, ctx)
}

/**
 * The repository gh picks from the remotes where the command runs, for
 * targetOf and gh api's placeholders (Copilot review of #26, seventh round).
 *
 * ctx.repo is repoAt of that place, read once per directory with the
 * environment the hook inherited. That is the environment gh inherits as
 * well, so for a command that gives git no config of its own the reading
 * stays what it was: origin as repoAt reads it. A command that sets a
 * variable of repo.mjs' gitConfigVariable (on itself, or exported earlier
 * on the line: command.env holds both) gives gh a config repoAt did not
 * read, and is read again with exactly its environment (configuredRemote).
 * Unknown, judged as this project for a refusal and never for a pass, when
 * any of those variables cannot be read, when that config is not one the
 * hook reads in full, or when an earlier command of the line changed the
 * remotes (ctx.repo.remotesChanged, from guard-bash): the config on disk is
 * then not the one gh reads. `why` says which.
 * @returns {{ repo: string | null, unknown: boolean, why?: string }}
 */
function remotesRepo(command, ctx) {
  if (!remotesKnown(ctx)) return { repo: null, unknown: true }
  const config = commandGitConfig(
    command.env ?? {},
    ctx.env ?? process.env,
    ctx.cwd,
  )
  if (!config.set) return { repo: ctx.repo?.repo ?? null, unknown: false }
  if (!config.known) return { repo: null, unknown: true, why: config.why }
  // No repository there: gh finds no remote to pick, whatever the config.
  if (ctx.repo == null) return { repo: null, unknown: false }
  if (ctx.repo.remotesChanged === true || typeof ctx.repo.gitDir !== 'string')
    return {
      repo: null,
      unknown: true,
      why: `${config.what}, e um comando anterior da linha mudou os remotes que ela lê`,
    }
  const found = configuredRemote(ctx.repo, config.env)
  return found.known
    ? { repo: found.repo, unknown: false }
    : { repo: null, unknown: true, why: `${config.what}, e ${found.why}` }
}

// ---------------------------------------------------------------------------
// What the hook cannot read

/**
 * A value the hook cannot read (an expansion, a file or an --input it cannot
 * open, a GraphQL variable the call does not send, a live read that failed)
 * inside a rule that refuses what it can read: a label, a body, a title, a
 * state, a thread, a message. It asks, critical, so the modes where nobody
 * is asked refuse it instead of letting it through unseen (Copilot review of
 * #26, third round). A rule that only asks when it can read (editing a body
 * after the Approve) keeps a plain ask; and nothing unread is ever dropped
 * as if it were not there.
 */
const unread = (reason) => ask(reason, { critical: true })

// ---------------------------------------------------------------------------
// What a body opens with, and the skip strings

const refusedOpenings = new Set(['approve', 'withdraw', 'approve-like'])

const quote = (line) => `"${line.length > 80 ? `${line.slice(0, 79)}…` : line}"`

/**
 * The texts of a body and whether any of it could not be read: every
 * occurrence counts, not only the last one gh keeps, so a refused opening
 * hidden behind a second `--body` is still seen.
 * @param {{ known: boolean, text: string | null, source?: string, all?: object[] }} body
 */
function textsOf(body) {
  const parts = [body, ...(body.all ?? [])]
  return {
    unknown: parts.some((part) => part.known === false),
    texts: parts
      .filter((part) => part.known !== false && typeof part.text === 'string')
      .map((part) => part.text),
  }
}

/**
 * The opening check: a body whose first line opens as an Approve, a
 * withdrawal or any heading that mentions Approve (commentOpening) is
 * refused; one that could not be read asks.
 */
function openingDecision(body) {
  const { unknown, texts } = textsOf(body)
  for (const text of texts)
    if (refusedOpenings.has(commentOpening(text)))
      return deny(
        `um comentário do agente não abre como Approve, retirada nem título que mencione approve (a primeira linha é ${quote(headAndRest(text).head)}): só o dono escreve essas linhas`,
      )
  if (unknown)
    return unread(
      'não consegui ler o corpo do comentário para conferir a primeira linha',
    )
  return pass()
}

/**
 * A skip string in any of the texts refuses the command; a text the hook
 * cannot read (`unknown`, which `unread` names) asks, critical, since it may
 * hold one.
 */
function skipDecision(
  texts,
  where,
  { unknown = false, unread: what = where } = {},
) {
  for (const text of texts) {
    const token = skipTokenIn(text)
    if (token !== null)
      return deny(
        `${where} traz "${token}", que faz o GitHub pular os checks do merge e do push: tire-o`,
      )
  }
  if (unknown)
    return unread(
      `não consegui ler ${what} para conferir que não traz um texto que faz o GitHub pular os checks`,
    )
  return pass()
}

/** The skip check on option values (a title, a subject), each read or not. */
function skipInWords(words, where) {
  return skipDecision(knownTexts(words), where, {
    unknown: words.some((word) => !word.known),
  })
}

/**
 * The body options of a gh command, read relative to its directory. A file
 * an earlier command of the line writes (ctx.files, from guard-bash) is read
 * as that command leaves it, not as it is on disk now.
 */
function bodyOf(command, ctx, options = {}) {
  const read = readBody({ ...command, cwd: null }, ctx.cwd, options)
  if (typeof ctx.files !== 'function') return read
  const bodyFlags = options.bodyFlags ?? ['-b', '--body']
  const fileFlags = options.fileFlags ?? ['-F', '--body-file']
  const found = findOptions(command.argv.map(String), [
    ...bodyFlags,
    ...fileFlags,
  ])
  const all = read.all.map((part, index) => {
    const option = found[index]
    if (option === undefined || !fileFlags.includes(option.name)) return part
    const fresh = readSource(
      command,
      ctx.cwd,
      option.value,
      wordKnown(command, option.index),
      ctx.files,
    )
    return { known: fresh.known, text: fresh.text, source: part.source }
  })
  if (read.source === 'editor' || read.source === 'web' || all.length === 0)
    return { ...read, all }
  return { ...all.at(-1), all }
}

const knownTexts = (words) =>
  words.filter((word) => word.known).map((word) => word.value)

// ---------------------------------------------------------------------------
// Labels

const isState = (name) => stateLabels.includes(name)
const { from: planFrom, to: planTo } = agentPlanLabelTransition

/** Label names from label options, split on commas and folded as GitHub compares them. */
function labelsOf(command, names) {
  return optionWords(command, names).flatMap((word) =>
    word.known
      ? word.value
          .split(',')
          .map((name) => name.trim().toLowerCase())
          .filter((name) => name !== '')
          .map((name) => ({ name, known: true }))
      : [{ name: word.value, known: false }],
  )
}

const labelRule = `o agente só troca ${planFrom} por ${planTo}, logo depois de publicar um # Plano; o Approve e ${readyLabel} são do dono`

const unknownLabels =
  'não consegui ler as labels do comando: confira que nenhuma é label de estado'

// ---------------------------------------------------------------------------
// The subcommands

function issueComment(command, ctx) {
  const decisions = [openingDecision(bodyOf(command, ctx))]
  if (hasFlag(command, ['--edit-last']))
    decisions.push(ask('editar um comentário depois do Approve o revoga'))
  // Spec silent: deleting a comment after the Approve revokes it as well
  // (approveState), so it asks like an edit.
  if (hasFlag(command, ['--delete-last']))
    decisions.push(ask('apagar um comentário depois do Approve o revoga'))
  return combine(decisions)
}

/** The state labels an issue may be created with: at most one, and one the agent may set. */
function createLabels(labels) {
  const decisions = []
  if (labels.some((label) => !label.known))
    decisions.push(unread(unknownLabels))
  const states = [
    ...new Set(
      labels
        .filter((label) => label.known && isState(label.name))
        .map((label) => label.name),
    ),
  ]
  if (states.includes(readyLabel))
    decisions.push(
      deny(`${readyLabel} é do dono: só ele a aplica, depois do Approve`),
    )
  const outside = states.filter(
    (name) => name !== readyLabel && !agentCreateStateLabels.includes(name),
  )
  if (outside.length > 0)
    decisions.push(
      deny(
        `uma issue do agente nasce com ${agentCreateStateLabels.join(' ou ')}, não com ${outside.join(', ')}`,
      ),
    )
  if (states.length > 1)
    decisions.push(
      deny(
        `uma issue nasce com uma só label de estado, e este comando põe ${states.join(' e ')}`,
      ),
    )
  return combine(decisions)
}

// Spec silent: `gh issue close --comment` posts a comment on the issue, so
// it takes the opening check like gh issue comment.
function issueClose(command, ctx) {
  return openingDecision(
    bodyOf(command, ctx, {
      bodyFlags: ['-c', '--comment'],
      fileFlags: [],
      unknownFlags: [],
    }),
  )
}

// Spec silent: renaming or deleting a state label moves every issue that
// carries it (ready-for-human renamed to ready-for-agent opens them all), and
// `create --force` rewrites one. The state labels are the contract's.
function labelChange(command, ctx) {
  const names = [
    ...ctx.operands.slice(0, 1),
    ...optionWords(command, ['-n', '--name']),
  ]
  if (names.some((name) => !name.known)) return unread(unknownLabels)
  const touched = names
    .map((name) => name.value.trim().toLowerCase())
    .filter(isState)
  if (touched.length > 0)
    return deny(
      `as labels de estado (${[...new Set(touched)].join(', ')}) são do contrato do loop: o agente não as cria, renomeia nem apaga`,
    )
  return pass()
}

function issueCreate(command, ctx) {
  const decisions = [
    openingDecision(bodyOf(command, ctx)),
    createLabels(labelsOf(command, ['-l', '--label'])),
  ]
  // Spec silent: --recover restores a body and labels from a file the hook
  // does not read. Either could be refused (an Approve, ready-for-agent), so
  // it asks, critical.
  if (recovers(command))
    decisions.push(
      unread(
        'gh issue create --recover traz corpo e labels de um arquivo que o hook não confere',
      ),
    )
  return combine(decisions)
}

/** Whether the command restores its input from a --recover file. */
const recovers = (command) =>
  hasFlag(command, ['--recover']) ||
  command.argv.some((arg) => String(arg).startsWith('--recover='))

/**
 * The one exception to the label rule, read live: the issue is in
 * agentPlanLabelTransition.from and its last comment opens as a plan.
 */
function planTransition(github, target, number) {
  const read = github.issueState(target, number)
  if (!read.ok)
    return unread(
      `não consegui confirmar que a issue está em ${planFrom} com um # Plano como último comentário (${read.reason})`,
    )
  const { labels, labelsComplete, lastCommentBody } = read.value
  const folded = labels.map((name) => String(name).toLowerCase())
  const unmet = []
  if (!folded.includes(planFrom)) {
    if (!labelsComplete)
      return unread(
        `não consegui confirmar que a issue #${number} está em ${planFrom}: ela tem mais labels do que uma página`,
      )
    unmet.push(
      `a issue #${number} não está em ${planFrom} (labels: ${labels.join(', ') || 'nenhuma'})`,
    )
  }
  if (commentOpening(lastCommentBody) !== 'plan')
    unmet.push(
      lastCommentBody === null
        ? `a issue #${number} não tem comentário`
        : `o último comentário da issue #${number} não abre com # Plano (abre com ${quote(headAndRest(lastCommentBody).head)})`,
    )
  if (unmet.length > 0)
    return deny(
      `a troca de ${planFrom} por ${planTo} só vale logo depois de um # Plano: ${unmet.join('; ')}`,
    )
  return pass()
}

function issueEdit(command, ctx) {
  const adds = labelsOf(command, ['--add-label'])
  const removes = labelsOf(command, ['--remove-label'])
  const decisions = []
  const added = new Set(
    adds.filter((l) => l.known && isState(l.name)).map((l) => l.name),
  )
  const removed = new Set(
    removes.filter((l) => l.known && isState(l.name)).map((l) => l.name),
  )
  const others = [...adds, ...removes].filter(
    (label) => !label.known || !isState(label.name),
  )
  if (added.size > 0 || removed.size > 0) {
    const refs = ctx.operands.map(refOf)
    const exception =
      added.size === 1 &&
      added.has(planTo) &&
      removed.size === 1 &&
      removed.has(planFrom) &&
      others.length === 0 &&
      refs.length === 1 &&
      refs[0] !== null
    // A repository the command names through something the hook cannot
    // read is judged as this project for a refusal, never for a pass: the
    // live read of this project's issue says nothing of another repository's
    // (Copilot review of #26).
    decisions.push(
      !exception
        ? deny(labelRule)
        : ctx.targetKnown === false
          ? unread(
              `não consegui ler em que repositório o comando troca ${planFrom} por ${planTo}${ctx.targetWhy ? ` (${ctx.targetWhy})` : ''}: confira que a issue #${refs[0].number} é deste projeto, está em ${planFrom} e tem um # Plano como último comentário`,
            )
          : planTransition(ctx.github, ctx.target, refs[0].number),
    )
  } else if (others.some((label) => !label.known))
    decisions.push(unread(unknownLabels))
  const body = bodyOf(command, ctx, { unknownFlags: [] })
  if (body.source !== 'none')
    decisions.push(
      ask('editar o corpo da issue depois do Approve o revoga'),
      openingDecision(body),
    )
  return combine(decisions)
}

/** Why a new PR with no body is refused: the reason gh pr create gives. */
const noPrBody = (issue) =>
  `a PR precisa de um corpo cuja primeira linha é exatamente "Closes #${issue ?? 'N'}."`

/** The first line of a PR body against the branch's issue. */
function closesDecision(text, issue, what) {
  const head = headAndRest(text).head
  const matched = closesLine.exec(head)
  if (matched === null)
    return deny(
      `a primeira linha do corpo ${what} é exatamente "Closes #${issue ?? 'N'}."; hoje é ${quote(head)}`,
    )
  if (issue !== null && Number(matched[1]) !== issue)
    return deny(
      `o corpo ${what} fecha a #${matched[1]}, mas a branch é da #${issue}`,
    )
  return pass()
}

function prCreate(command, ctx) {
  const decisions = []
  const heads = optionWords(command, ['-H', '--head'])
  let { value: branch, known: branchKnown } = branchOf(ctx)
  if (heads.length > 0) {
    const last = heads.at(-1)
    branchKnown = last.known
    // A fork's head is `owner:branch`; the branch is what names the issue.
    branch = last.value.includes(':')
      ? last.value.slice(last.value.indexOf(':') + 1)
      : last.value
  }
  const parsed = branchKnown ? parseBranch(branch) : null
  if (!branchKnown)
    decisions.push(
      unread(
        `não consegui ler a branch da PR: ela precisa ser ${branchShapes}`,
      ),
    )
  else if (parsed === null)
    decisions.push(
      deny(
        `a PR sai de uma branch ${branchShapes}; ${branch === null ? 'o HEAD está destacado' : `"${branch}" não é uma`}`,
      ),
    )
  const issue = parsed?.issue ?? null
  const body = bodyOf(command, ctx)
  const filling = hasFlag(command, [
    '-f',
    '--fill',
    '--fill-first',
    '--fill-verbose',
  ])
  // --web and --editor write the body after the hook ran, where it can
  // never look: neither the Closes line nor a skip string can be checked, so
  // a person must, and in the autonomous modes nobody does (Copilot review
  // of #26). A body file or an expansion the hook could not read asks the
  // same way: a body it can read and that misses the Closes line is refused.
  if (body.source === 'web' || body.source === 'editor')
    decisions.push(
      ask(
        body.source === 'web'
          ? `gh pr create --web: o corpo é escrito no navegador, fora do alcance do hook; confira que a primeira linha é exatamente "Closes #${issue ?? 'N'}." e que nem o título nem o corpo trazem um texto que pula os checks`
          : `gh pr create --editor: o corpo é escrito no editor, fora do alcance do hook; confira que a primeira linha é exatamente "Closes #${issue ?? 'N'}." e que nem o título nem o corpo trazem um texto que pula os checks`,
        { critical: true },
      ),
    )
  else if (!body.known)
    decisions.push(
      unread('não consegui ler o corpo da PR para conferir a primeira linha'),
    )
  else if (body.source === 'none')
    decisions.push(
      deny(
        filling
          ? `--fill sem --body tira o corpo dos commits, e a primeira linha precisa ser exatamente "Closes #${issue ?? 'N'}."`
          : noPrBody(issue),
      ),
    )
  else decisions.push(closesDecision(body.text, issue, 'da PR'))
  const titles = optionWords(command, ['-t', '--title'])
  // With no --title, --fill takes the title from the commits, which the
  // hook does not read here.
  if (titles.length === 0 && filling)
    decisions.push(
      unread(
        '--fill sem --title tira o título dos commits, que o hook não lê aqui: dê o título com --title para ele conferir que não traz um texto que pula os checks',
      ),
    )
  if (recovers(command))
    decisions.push(
      unread(
        'gh pr create --recover traz título e corpo de um arquivo que o hook não confere',
      ),
    )
  // A body it cannot read already asks above; an earlier --body it cannot
  // read, which gh drops, still asks here.
  const { texts, unknown } = textsOf(body)
  decisions.push(
    skipInWords(titles, 'o título da PR'),
    skipDecision(texts, 'o corpo da PR', { unknown: unknown && body.known }),
  )
  return combine(decisions)
}

function prEdit(command, ctx) {
  const decisions = [
    skipInWords(optionWords(command, ['-t', '--title']), 'o título da PR'),
  ]
  const body = bodyOf(command, ctx, { unknownFlags: [] })
  if (body.source !== 'none') {
    const { texts, unknown } = textsOf(body)
    decisions.push(
      skipDecision(texts, 'o corpo da PR', { unknown: unknown && body.known }),
    )
    if (!body.known)
      decisions.push(
        unread(
          'não consegui ler o novo corpo da PR para conferir a primeira linha',
        ),
      )
    else if (ctx.operands.length === 0 && !branchOf(ctx).known)
      decisions.push(
        unread(
          'não consegui saber a branch da PR que o gh pr edit muda, para conferir o Closes #N. do novo corpo',
        ),
      )
    else {
      // Only the PR of the branch checked out is known to belong to the
      // branch's issue; a PR named by number is held to the shape alone.
      const issue =
        ctx.operands.length === 0 ? issueFromBranch(branchOf(ctx).value) : null
      decisions.push(closesDecision(body.text, issue, 'da PR'))
    }
  }
  return combine(decisions)
}

function mergeDecision(read) {
  if (!read.ok)
    return ask(
      `não consegui ler o estado da PR (${read.reason}): confira os checks exigidos, a revisão do Copilot na cabeça e as threads antes do merge`,
      { critical: true },
    )
  const state = read.value
  const head = short(state.headRefOid)
  const problems = []
  if (state.state !== 'OPEN')
    problems.push(`a PR está ${state.state ?? 'num estado desconhecido'}`)
  if (!state.pagesComplete)
    problems.push(`não li por inteiro: ${state.unread.join(', ')}`)
  if (!state.checksOk) problems.push(`checks exigidos: ${state.checksDetail}`)
  if (!state.review.ok)
    problems.push(
      state.review.failed
        ? `a última revisão do Copilot falhou, e nenhuma cobre a cabeça ${head}`
        : `nenhuma revisão do Copilot na cabeça ${head}`,
    )
  if (state.requested)
    problems.push('há uma revisão do Copilot pedida e ainda a caminho')
  if (state.openThreads.length > 0)
    problems.push(
      `${state.openThreads.length} thread(s) de revisão aberta(s): responda em cada uma e só então a resolva`,
    )
  if (problems.length > 0)
    return deny(
      `o merge da PR #${state.number} não está pronto: ${problems.join('; ')}`,
    )
  return ask(
    `confira antes do merge: PR #${state.number} na cabeça ${head}, ${state.checksDetail}, revisão do Copilot na cabeça, nenhum pedido de revisão pendente e nenhuma thread aberta`,
    { critical: true },
  )
}

function prMerge(command, ctx) {
  if (hasFlag(command, ['--admin']))
    return deny(
      'gh pr merge --admin passa por cima das regras do repositório: o merge espera os checks, a revisão do Copilot e as threads',
    )
  if (hasFlag(command, ['--auto']))
    return deny('o merge automático acontece depois, sem conferir a revisão')
  // Turning auto-merge off merges nothing and only restricts.
  if (hasFlag(command, ['--disable-auto'])) return pass()
  const body = bodyOf(command, ctx, { unknownFlags: [] })
  const { texts, unknown } = textsOf(body)
  const skip = combine([
    skipInWords(
      optionWords(command, ['-t', '--subject']),
      'o assunto do merge',
    ),
    skipDecision(texts, 'o corpo do merge', { unknown }),
  ])
  if (skip.decision === 'deny') return skip
  // A subject or body it cannot read still asks, critical, next to what
  // the live read says: a merge that is not ready is refused either way.
  const judged = (decision) => combine([skip, decision])
  const operand = ctx.operands[0]
  const branch = branchOf(ctx)
  let prRef = null
  if (operand === undefined) prRef = branch.known ? branch.value : null
  else if (operand.known) prRef = refOf(operand)?.number ?? operand.value
  if (prRef === null)
    return judged(
      mergeDecision(
        failed(
          operand !== undefined
            ? `"${operand.value}" não pôde ser lido`
            : branch.known
              ? 'sem número e com o HEAD destacado'
              : 'sem número, e a branch em que ele roda não pôde ser lida',
        ),
      ),
    )
  // A repository that cannot be read is not read as this project's PR
  // (Copilot review of #26): it asks, critical, as a failed read does.
  if (ctx.targetKnown === false)
    return judged(
      mergeDecision(
        failed(
          `o repositório da PR não pôde ser lido${ctx.targetWhy ? ` (${ctx.targetWhy})` : ''}`,
        ),
      ),
    )
  return judged(mergeDecision(ctx.github.prMergeState(ctx.target, prRef)))
}

// ---------------------------------------------------------------------------
// Aliases

/**
 * gh's own commands, as `gh --help` lists them (2.101): a word in their place
 * is never an alias, since gh refuses an alias named after one of them. Any
 * other word is looked up as an alias.
 */
const ghCommands = new Set(
  `accessibility actions agent-task alias api attestation auth browse cache
  codespace completion config copilot credits discussion environment
  exit-codes extension formatting gist gpg-key help issue label licenses
  mintty org pr preview project reference release repo ruleset run search
  secret skill ssh-key status telemetry variable version workflow`.split(/\s+/),
)

/** The alias gh ships in a fresh config. */
const defaultGhAliases = () =>
  new Map([['co', { known: true, text: 'pr checkout' }]])

/** A one-line YAML scalar: plain, '…' or "…". { ok: false } for anything else. */
function yamlScalar(raw) {
  const text = raw.trim()
  if (text === '' || text === '~' || text === 'null')
    return { ok: true, value: '' }
  const single = /^'((?:[^']|'')*)'[ \t]*(?:#.*)?$/.exec(text)
  if (single) return { ok: true, value: single[1].replaceAll("''", "'") }
  const double = /^"((?:[^"\\]|\\.)*)"[ \t]*(?:#.*)?$/.exec(text)
  if (double)
    try {
      return { ok: true, value: JSON.parse(`"${double[1]}"`) }
    } catch {
      return { ok: false }
    }
  if (/^['"[{&*!|>%@`]/.test(text)) return { ok: false }
  return { ok: true, value: text.replace(/[ \t]+#.*$/, '') }
}

/**
 * The flat mapping of names to texts a gh config (under `under:`) or a `gh
 * alias import` file holds, read without a YAML library: plain, quoted and
 * block (`|`, `>`) scalars, one level deep. A value it cannot read is kept as
 * unknown; a shape it does not expect makes the whole file unreadable.
 * @returns {{ ok: boolean, map: Map<string, { known: boolean, text: string | null }> }}
 */
function yamlAliases(text, under = null) {
  const lines = String(text).split(/\r?\n/)
  const map = new Map()
  let i = 0
  let parent = -1
  if (under !== null) {
    const at = lines.findIndex((line) =>
      new RegExp(`^${under}:(?:[ \\t]|$)`).test(line),
    )
    if (at < 0) return { ok: true, found: false, map }
    const rest = lines[at]
      .slice(under.length + 1)
      .replace(/[ \t]+#.*$/, '')
      .trim()
    if (rest === '{}') return { ok: true, found: true, map }
    if (rest !== '') return { ok: false, map }
    i = at + 1
    parent = 0
  }
  let indent = null
  while (i < lines.length) {
    const line = lines[i]
    if (/^[ \t]*(?:#.*)?$/.test(line)) {
      i += 1
      continue
    }
    const lead = /^ */.exec(line)[0].length
    if (lead <= parent) break
    indent ??= lead
    if (lead !== indent) return { ok: false, map }
    const entry =
      /^ *("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s'"#][^:]*?)[ \t]*:(?:[ \t]+(.*))?$/.exec(
        line,
      )
    if (entry === null) return { ok: false, map }
    const key = yamlScalar(entry[1])
    if (!key.ok) return { ok: false, map }
    const raw = (entry[2] ?? '').trim()
    const block = /^([|>])([+-]?)\d*[ \t]*(?:#.*)?$/.exec(raw)
    if (block === null) {
      const value = yamlScalar(raw)
      map.set(key.value, {
        known: value.ok,
        text: value.ok ? value.value : null,
      })
      i += 1
      continue
    }
    const body = []
    let j = i + 1
    let blockIndent = null
    while (j < lines.length) {
      const next = lines[j]
      if (next.trim() === '') {
        body.push('')
        j += 1
        continue
      }
      const nextLead = /^ */.exec(next)[0].length
      if (nextLead <= lead) break
      blockIndent ??= nextLead
      body.push(next.slice(Math.min(blockIndent, nextLead)))
      j += 1
    }
    while (body.length > 0 && body.at(-1) === '') body.pop()
    const joined = block[1] === '|' ? body.join('\n') : body.join(' ')
    map.set(key.value, {
      known: true,
      text: block[2] === '-' ? joined : `${joined}\n`,
    })
    i = j
  }
  return { ok: true, found: true, map }
}

/** Where gh keeps its config, as gh finds it, or null. */
function ghConfigDir(env) {
  if (env.GH_CONFIG_DIR) return env.GH_CONFIG_DIR
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'gh')
  if (process.platform === 'win32' && env.AppData)
    return path.join(env.AppData, 'GitHub CLI')
  if (env.HOME) return path.join(env.HOME, '.config', 'gh')
  return null
}

/**
 * The aliases in gh's config, as the command's environment points at it.
 * No config is gh's default one; one that cannot be read is { ok: false }.
 */
function ghConfigAliases(env) {
  const dir = ghConfigDir(env)
  if (dir === null) return { ok: true, aliases: defaultGhAliases() }
  if (/[$`]/.test(dir))
    return {
      ok: false,
      reason: 'o diretório de configuração do gh não pôde ser lido',
    }
  const file = path.join(dir, 'config.yml')
  if (!existsSync(file)) return { ok: true, aliases: defaultGhAliases() }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, reason: `${file} não pôde ser lido` }
  }
  const read = yamlAliases(text, 'aliases')
  if (!read.ok) return { ok: false, reason: `${file} não pôde ser lido` }
  return { ok: true, aliases: read.found ? read.map : defaultGhAliases() }
}

/**
 * The alias `name` as this command would find it: one an earlier command of
 * the line set (ctx.ghAliases, from guard-bash), else gh's config.
 * @returns {{ ok: true, expansion: { known: boolean, text: string | null } | null } | { ok: false, reason: string }}
 */
function ghAliasOf(name, command, ctx) {
  if (ctx.ghAliases?.has(name))
    return { ok: true, expansion: ctx.ghAliases.get(name) }
  const config = ghConfigAliases(envOf(command, ctx))
  if (!config.ok) return config
  return { ok: true, expansion: config.aliases.get(name) ?? null }
}

const shellWord = (word) =>
  word.known ? `'${word.value.replaceAll("'", "'\\''")}'` : '"${ARGUMENTO}"'

/**
 * The command line an alias runs, as gh expands it: `$1`, `$2`… take the
 * arguments in order (and then no argument is appended), else the arguments
 * are appended; an expansion that starts with `!` is a shell script that
 * gets them as $1, $2….
 */
function aliasText(expansion, args) {
  if (expansion.trimStart().startsWith('!'))
    return { shell: true, text: expansion.trimStart().slice(1) }
  // gh splits the expansion on any whitespace: a newline (a YAML block)
  // does not end the command before the arguments.
  const words = expansion.trim().replace(/\s+/g, ' ')
  if (!words.includes('$'))
    return {
      shell: false,
      text: `gh ${words} ${args.map(shellWord).join(' ')}`,
    }
  let text = words
  args.forEach((arg, index) => {
    text = text.replaceAll(
      `$${index + 1}`,
      arg.known ? arg.value : '${ARGUMENTO}',
    )
  })
  return { shell: false, text: `gh ${text}` }
}

/**
 * The commands an alias runs, judged as if they had been typed: gh through
 * these rules, anything else through ctx.judgeOther (guard-bash), or asked.
 * `live` false judges without reading GitHub, for an alias being defined.
 */
async function judgeAlias(name, expansion, args, command, ctx, { live }) {
  if ((ctx.aliasDepth ?? 0) >= 5)
    return unread(
      `o alias ${name} do gh leva a aliases demais: confira o que ele roda`,
    )
  const { shell, text } = aliasText(expansion, args)
  const parsed = parseCommand(text)
  if (parsed.unparsable || parsed.commands.length === 0)
    return unread(
      `não consegui ler o alias ${name} do gh ("${expansion.trim()}"): confira o que ele roda`,
    )
  const inner = extend(ctx, {
    aliasDepth: (ctx.aliasDepth ?? 0) + 1,
    ...(live ? {} : { github: offline, githubFor: () => offline }),
  })
  const decisions = []
  for (const each of parsed.commands) {
    const run = {
      ...each,
      env: { ...command.env, ...each.env },
      ...(shell || each.stdin !== null
        ? {}
        : {
            stdin: command.stdin,
            stdinKnown: command.stdinKnown,
            stdinFile: command.stdinFile,
          }),
    }
    const here =
      each.cwd === null
        ? inner
        : extend(inner, {
            cwd: path.resolve(ctx.cwd, each.cwd),
            cwdKnown: false,
          })
    if (!(each.known?.[0] ?? true))
      decisions.push(
        unread(
          `o alias ${name} do gh roda um programa que o hook não consegue ler: confira o que ele faz`,
        ),
      )
    else if (each.argv[0] === 'gh') decisions.push(await ghDecision(run, here))
    else if (typeof ctx.judgeOther === 'function')
      decisions.push(await ctx.judgeOther(run, here))
    else if (each.argv[0] === 'git')
      decisions.push(
        unread(
          `o alias ${name} do gh roda git, que o hook não confere aqui: confira que não é commit nem push em ${trunk}`,
        ),
      )
  }
  const decision = combine(decisions)
  if (decision.decision === 'pass') return pass()
  const reason = `o alias ${name} do gh é "${expansion.trim()}": ${decision.reason}`
  return decision.decision === 'deny'
    ? deny(reason)
    : ask(reason, { critical: decision.critical === true })
}

/** Using an alias: `gh <alias> args…` is judged as what it expands to. */
async function aliasUse(command, ctx, group) {
  const found = ghAliasOf(group.value, command, ctx)
  if (!found.ok)
    return unread(
      `não consegui ler os aliases do gh (${found.reason}): confira que "${group.value}" não é um alias de um comando que o hook confere`,
    )
  // Not an alias either: an extension, or a word gh will refuse.
  if (found.expansion === null) return pass()
  if (!found.expansion.known)
    return unread(
      `não consegui ler o alias ${group.value} do gh: confira o que ele roda`,
    )
  const argv = command.argv.map(String)
  const args = argv.slice(group.index + 1).map((value, offset) => ({
    value,
    known: wordKnown(command, group.index + 1 + offset),
  }))
  return judgeAlias(group.value, found.expansion.text, args, command, ctx, {
    live: true,
  })
}

/** The text of an alias being set: the operand, or stdin for `-`. */
function expansionOf(command, ctx, expansion) {
  if (expansion === undefined) return null
  if (!expansion.known) return { known: false, text: null }
  if (expansion.value !== '-') return { known: true, text: expansion.value }
  return readSource(command, ctx.cwd, '-', true, ctx.files)
}

async function aliasSet(command, ctx, from) {
  const operands = operandsOf(command, from, valuedFlags['alias set'])
  const [name, expansion] = operands
  const text = expansionOf(command, ctx, expansion)
  if (text === null) return pass()
  // An expansion it cannot read could be one the rule refuses: it asks,
  // critical, besides what the tripwire says (Copilot review of #26).
  if (!text.known)
    return unread(
      `não consegui ler o que o alias ${name?.value ?? ''} do gh roda: confira que não é um comando que o hook nega`,
    )
  const shell =
    hasFlag(command, ['-s', '--shell']) && !text.text.startsWith('!')
  const decision = await judgeAlias(
    name?.value ?? '',
    shell ? `!${text.text}` : text.text,
    [],
    command,
    ctx,
    { live: false },
  )
  if (decision.decision === 'pass') return pass()
  const reason = `o alias ${name?.value ?? ''} faria o que o hook confere a cada comando: ${decision.reason}`
  return decision.decision === 'deny'
    ? deny(reason)
    : ask(reason, { critical: decision.critical === true })
}

/**
 * The aliases a `gh alias import` file (or stdin) brings, or null when
 * unreadable. With no file, gh reads stdin, as it does for `-` (Copilot
 * review of #26, third round).
 */
function importedAliases(command, ctx, from) {
  const [file] = operandsOf(command, from, [])
  if (file !== undefined && !file.known) return null
  const read = readSource(command, ctx.cwd, file?.value ?? '-', true, ctx.files)
  if (!read.known) return null
  const parsed = yamlAliases(read.text)
  return parsed.ok ? parsed.map : null
}

async function aliasImport(command, ctx, from) {
  const aliases = importedAliases(command, ctx, from)
  if (aliases === null)
    return unread(
      'não consegui ler os aliases que o gh alias import traz: confira que nenhum deles faz o que o hook nega',
    )
  const decisions = []
  for (const [name, expansion] of aliases)
    decisions.push(
      expansion.known
        ? await judgeAlias(name, expansion.text, [], command, ctx, {
            live: false,
          })
        : unread(
            `não consegui ler o alias ${name} que o gh alias import traz: confira o que ele roda`,
          ),
    )
  const decision = combine(decisions)
  if (decision.decision === 'pass') return pass()
  const reason = `o gh alias import traria aliases que fazem o que o hook confere a cada comando: ${decision.reason}`
  return decision.decision === 'deny'
    ? deny(reason)
    : ask(reason, { critical: decision.critical === true })
}

/** The first two words of a gh command that are not options: its group and verb. */
function leadingWords(command) {
  const argv = command.argv.map(String)
  const words = []
  for (let k = 1; k < argv.length && words.length < 2; k += 1) {
    if (argv[k] === '-R' || argv[k] === '--repo') {
      k += 1
      continue
    }
    if (argv[k].startsWith('-')) continue
    words.push({ value: argv[k], index: k, known: wordKnown(command, k) })
    if (argv[k] === 'api') break
  }
  return words
}

/**
 * The aliases a gh command defines for the commands after it on the same
 * line (guard-bash): `alias set`, `alias import` and `alias delete`, as
 * [name, { known, text } | null], null for a deleted one. A name that
 * cannot be read is left out: the alias is still judged when it is set.
 */
export function ghAliasDefinitions(command, ctx) {
  const [group, verb] = leadingWords(command)
  if (group?.value !== 'alias' || verb === undefined || !verb.known) return []
  const local = extend(ctx, {})
  if (verb.value === 'set') {
    const [name, expansion] = operandsOf(command, verb.index + 1, [])
    if (!name?.known) return []
    const text = expansionOf(command, local, expansion)
    if (text === null) return []
    const shell =
      text.known &&
      hasFlag(command, ['-s', '--shell']) &&
      !text.text.startsWith('!')
    return [
      [
        name.value,
        text.known
          ? { known: true, text: shell ? `!${text.text}` : text.text }
          : { known: false, text: null },
      ],
    ]
  }
  if (verb.value === 'import') {
    const aliases = importedAliases(command, local, verb.index + 1)
    return aliases === null ? [] : [...aliases]
  }
  if (verb.value === 'delete') {
    const [name] = operandsOf(command, verb.index + 1, [])
    return name?.known ? [[name.value, null]] : []
  }
  return []
}

/**
 * Whether a gh command checks another branch out where it runs (`gh pr
 * checkout`, `gh co` and any alias of it), for the commands after it on the
 * same line (guard-bash).
 */
export function ghMovesHead(command, ctx, depth = 0) {
  const [group, verb] = leadingWords(command)
  if (group === undefined || !group.known) return false
  if (group.value === 'pr')
    return verb?.value === 'checkout' || verb?.known === false
  if (ghCommands.has(group.value) || depth >= 5) return false
  const found = ghAliasOf(group.value, command, ctx)
  if (!found.ok || found.expansion?.known === false) return true
  if (found.expansion === null) return false
  const { shell, text } = aliasText(found.expansion.text, [])
  return parseCommand(text).commands.some(
    (inner) =>
      (inner.argv[0] === 'gh' && ghMovesHead(inner, ctx, depth + 1)) ||
      (shell && inner.argv[0] === 'git'),
  )
}

// ---------------------------------------------------------------------------
// gh api

/** A value the command holds but the hook could not read. */
const unknown = Symbol('unknown')

const hasUnknown = (value) =>
  value === unknown ||
  (value !== null &&
    typeof value === 'object' &&
    Object.values(value).some(hasUnknown))

/** `a[b][]` → ['a', 'b', ''], as gh reads a field's key. */
const keyPath = (key) => {
  const at = key.indexOf('[')
  if (at < 0) return [key]
  return [
    key.slice(0, at),
    ...[...key.slice(at).matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]),
  ]
}

function setParam(params, key, value) {
  const parts = keyPath(key)
  let node = params
  for (let p = 0; p < parts.length; p += 1) {
    const part = parts[p]
    const last = p === parts.length - 1
    const nextIsArray = !last && parts[p + 1] === ''
    if (part === '') {
      if (!Array.isArray(node)) return
      if (last) node.push(value)
      else {
        const child = nextIsArray ? [] : {}
        node.push(child)
        node = child
      }
      continue
    }
    if (last) node[part] = value
    else {
      if (node[part] == null || typeof node[part] !== 'object')
        node[part] = nextIsArray ? [] : {}
      node = node[part]
    }
  }
}

/** gh's -F conversion of a typed field's value; `@path` is read. */
function typedValue(command, ctx, raw, known) {
  if (raw.startsWith('@')) {
    const read = readSource(command, ctx.cwd, raw.slice(1), known, ctx.files)
    return read.known ? read.text : unknown
  }
  if (!known) return unknown
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+$/.test(raw)) return Number(raw)
  return raw
}

/**
 * The query string gh puts the fields on when `--input` carries the body,
 * as gh 2.101 flattens them (measured through a local proxy, Copilot review
 * of #26, sixth round): a nested field goes by its innermost key
 * (`x[state]=open` is sent as `state=open`, `a[b][]=c` as `b[]=c`), a list
 * of plain values as `key[]`, one value per entry. [[key, value]] pairs.
 */
function flatQuery(params, pairs = []) {
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const entry of value)
        if (entry !== null && typeof entry === 'object')
          if (Array.isArray(entry)) pairs.push([`${key}[]`, unknown])
          else flatQuery(entry, pairs)
        else pairs.push([`${key}[]`, entry])
    } else if (value !== null && typeof value === 'object')
      flatQuery(value, pairs)
    else pairs.push([key, value])
  }
  return pairs
}

/** The pairs of a query string written into the endpoint itself (`issues/5?state=open`). */
function endpointQuery(endpoint) {
  if (endpoint === null || !endpoint.known) return []
  const at = endpoint.value.indexOf('?')
  if (at < 0) return []
  const text = endpoint.value.slice(at + 1).replace(/#.*$/, '')
  return [...new URLSearchParams(text)]
}

/**
 * What a `gh api` call sends: its method, endpoint, body and query string.
 * The body is the `--input` JSON when there is one, else the fields, `-f`
 * raw and `-F` typed, nested as gh nests `a[b][]`. The query string holds
 * what the endpoint spells after `?` and, with `--input`, every field
 * (gh's help: "any parameters specified via field flags are added to the
 * query string"): `query` is those [[key, value]] pairs, null when there are
 * none, and `unknown` when a field's key cannot be read.
 */
function apiRequest(command, ctx, from) {
  const argv = command.argv.map(String)
  const params = {}
  // A field whose key cannot be read (`-f "$F"`, `-f "$K"=v`) may be any
  // key, `state` or `labels` included: the body it lands in is unknown
  // (Copilot review of #26, third round). A readable field with no `=` is
  // one gh refuses, and sends nothing.
  let keysKnown = true
  const found = findOptions(argv, ['-f', '--raw-field', '-F', '--field'])
  for (const option of found) {
    const known = wordKnown(command, option.index)
    const eq = option.value.indexOf('=')
    if (!known && (eq < 0 || /[$`]/.test(option.value.slice(0, eq)))) {
      keysKnown = false
      continue
    }
    if (eq < 0) continue
    const key = option.value.slice(0, eq)
    const raw = option.value.slice(eq + 1)
    const typed = option.name === '-F' || option.name === '--field'
    setParam(
      params,
      key,
      typed ? typedValue(command, ctx, raw, known) : known ? raw : unknown,
    )
  }
  const inputs = findOptions(argv, ['--input'])
  let body = keysKnown ? params : unknown
  const endpoint = operandsOf(command, from, valuedFlags.api)[0] ?? null
  const pairs = endpointQuery(endpoint)
  let query = pairs.length > 0 ? pairs : null
  if (inputs.length > 0 && found.length > 0) {
    // The fields leave the body for the query string: kept, not dropped.
    if (!keysKnown) query = unknown
    else if (Object.keys(params).length > 0)
      query = [...pairs, ...flatQuery(params)]
  }
  if (inputs.length > 0) {
    const last = inputs.at(-1)
    const read = readSource(
      command,
      ctx.cwd,
      last.value,
      wordKnown(command, last.index),
      ctx.files,
    )
    body = unknown
    if (read.known)
      try {
        body = JSON.parse(read.text)
      } catch {
        body = unknown
      }
  }
  const methods = findOptions(argv, ['-X', '--method'])
  let method = found.length > 0 || inputs.length > 0 ? 'POST' : 'GET'
  if (methods.length > 0) {
    const last = methods.at(-1)
    // A method that cannot be read may write: it is judged as one that does.
    method = wordKnown(command, last.index)
      ? last.value.toUpperCase()
      : 'UNKNOWN'
  }
  const hosts = findOptions(argv, ['--hostname'])
  return {
    method,
    body,
    query,
    endpoint,
    host: hosts.length > 0 ? hosts.at(-1).value : null,
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The query string as the fields GitHub could read from it, one object per
 * reading. A key given once is its value; `key[]` collects a list; a key
 * given more than once with different values (two nested fields gh flattens
 * to the same key) may be read as any of them, or none: one reading per
 * value, and one where it is unknown. A deeper key spelled in the endpoint
 * (`labels[][name]=x`) is nested as a Rails-like reader would nest it.
 */
function queryReadings(pairs) {
  const tops = new Map()
  for (const [key, value] of pairs) {
    const parts = keyPath(key)
    const top = parts[0]
    const entry = tops.get(top) ?? { plain: [], nested: {}, deep: false }
    if (parts.length === 1) entry.plain.push(value)
    else {
      entry.deep = true
      setParam(entry.nested, key, value)
    }
    tops.set(top, entry)
  }
  const fixed = {}
  const choices = []
  for (const [top, entry] of tops) {
    const seen = new Map()
    for (const value of entry.plain)
      seen.set(typeof value === 'symbol' ? value : String(value), value)
    const values = [...seen.values()]
    if (entry.deep) values.push(entry.nested[top])
    if (values.length === 1) fixed[top] = values[0]
    else choices.push([top, values])
  }
  if (choices.length === 0) return [fixed]
  const widest = Math.max(...choices.map(([, values]) => values.length))
  const readings = []
  for (let k = 0; k < widest; k += 1) {
    const reading = { ...fixed }
    for (const [top, values] of choices)
      reading[top] = values[Math.min(k, values.length - 1)]
    readings.push(reading)
  }
  const blind = { ...fixed }
  for (const [top] of choices) blind[top] = unknown
  readings.push(blind)
  return readings
}

/**
 * The bodies a call is judged as (Copilot review of #26, sixth round): the
 * one it sends, and, when parameters ride on the query string, that body
 * with them over it and under it, since which one GitHub reads, if it
 * reads the query string at all, cannot be known. A GraphQL body also gets
 * them as its variables. A query string that cannot be read is an unknown
 * body; a body that is no object (a list of labels) is read beside it.
 */
function bodiesOf(request, { graphql = false } = {}) {
  const { body, query } = request
  if (query === null || body === unknown) return [body]
  if (query === unknown) return [body, unknown]
  const bodies = [body]
  for (const reading of queryReadings(query)) {
    if (!isPlainObject(body)) {
      bodies.push(reading)
      continue
    }
    bodies.push({ ...reading, ...body }, { ...body, ...reading })
    if (graphql && isPlainObject(body.variables))
      bodies.push(
        { ...body, variables: { ...reading, ...body.variables } },
        { ...body, variables: { ...body.variables, ...reading } },
      )
  }
  // The same body twice would judge twice, and a thread's live read would
  // run twice.
  const seen = new Set()
  return bodies.filter((candidate) => {
    const key = JSON.stringify(candidate, (_, value) =>
      value === unknown ? '\u0000unknown' : value,
    )
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const queryNote =
  'Os parâmetros na query string da URL (os de -f/-F quando há --input, e os escritos no endpoint depois de ?) contam como campos do corpo: o GitHub pode lê-los.'

/**
 * The decision for every body a call is judged as, saying so when the query
 * string is what made it stricter than the body alone.
 */
function judgeBodies(bodies, judgeOne) {
  const alone = combine([judgeOne(bodies[0])])
  if (bodies.length === 1) return alone
  const all = combine(bodies.map(judgeOne))
  if (
    all.decision === alone.decision &&
    all.critical === alone.critical &&
    all.reason === alone.reason
  )
    return all
  return { ...all, reason: `${all.reason} ${queryNote}` }
}

/** A field of the body, as { present, known, value }. */
function fieldOf(body, key) {
  if (body === unknown) return { present: true, known: false, value: unknown }
  if (body === null || typeof body !== 'object' || !(key in body))
    return { present: false, known: true, value: undefined }
  const value = body[key]
  return { present: true, known: !hasUnknown(value), value }
}

/** A body field read as text for the opening check. */
function fieldText(field) {
  if (!field.present) return { known: true, text: null }
  if (!field.known) return { known: false, text: null }
  return {
    known: true,
    text: typeof field.value === 'string' ? field.value : String(field.value),
  }
}

/** Label names in a body: `labels` as a list, a name, or the whole body as a list. */
function labelNames(body, { whole = false } = {}) {
  if (body === unknown) return unknown
  const list =
    whole && Array.isArray(body)
      ? body
      : body !== null && typeof body === 'object' && 'labels' in body
        ? body.labels
        : []
  if (list === unknown) return unknown
  const items = Array.isArray(list) ? list : [list]
  const names = []
  for (const item of items) {
    const name =
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? item.name
        : item
    if (name === unknown || hasUnknown(name)) return unknown
    if (typeof name === 'string')
      names.push(
        ...name
          .split(',')
          .map((part) => part.trim().toLowerCase())
          .filter((part) => part !== ''),
      )
  }
  return names
}

const apiLabelRule = `o agente não escreve label de estado por gh api: a única troca permitida (${planFrom} por ${planTo}, logo depois de um # Plano) passa por gh issue edit`

const decode = (segment) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * A pull request created through the API (REST `pulls`, GraphQL
 * createPullRequest), held to the rules of gh pr create: its head is a
 * branch the gate accepts, its body opens with the Closes line of the
 * branch's issue, and neither the body nor the title carries a skip string.
 * A body left out is refused, as gh pr create refuses one; only a body the
 * hook cannot read asks (Copilot review of #26). Each field is
 * { present, known, value }.
 */
function apiPrCreate(head, body, title) {
  const branch =
    head.present && head.known && typeof head.value === 'string'
      ? head.value.slice(head.value.indexOf(':') + 1)
      : null
  const parsed = parseBranch(branch)
  const issue = parsed?.issue ?? null
  const text = fieldText(body)
  const heading = fieldText(title)
  const bodyDecision = !text.known
    ? unread('não consegui ler o corpo da PR para conferir a primeira linha')
    : text.text === null
      ? deny(noPrBody(issue))
      : closesDecision(text.text, issue, 'da PR')
  return combine([
    parsed === null ? deny(`a PR sai de uma branch ${branchShapes}`) : pass(),
    bodyDecision,
    skipDecision([heading.text, text.text], 'a PR', {
      unknown: !heading.known,
      unread: 'o título da PR',
    }),
  ])
}

function restDecision(method, route, body) {
  const [first, second, third, ...more] = route
  const numeric = (text) => /^[1-9]\d*$/.test(String(text ?? ''))

  // The repository's own settings, like gh repo edit.
  if (
    route.length === 0 ||
    (first === 'branches' && route.includes('protection')) ||
    first === 'rulesets'
  )
    return deny(
      'as configurações do repositório (proteções, regras, merge) são do dono',
    )

  if (first === 'issues' && numeric(second) && third === 'labels') {
    const names =
      more.length > 0
        ? [decode(more.join('/')).trim().toLowerCase()]
        : labelNames(body, { whole: true })
    if (names === unknown) return unread(unknownLabels)
    if (names.some(isState)) return deny(apiLabelRule)
    if (more.length === 0 && (method === 'PUT' || method === 'DELETE'))
      return deny(
        `trocar ou apagar todas as labels da issue leva a label de estado junto: ${apiLabelRule}`,
      )
    return pass()
  }

  if (first === 'issues' && numeric(second) && third === 'comments') {
    if (method !== 'POST') return pass()
    return openingDecision(fieldText(fieldOf(body, 'body')))
  }

  if (first === 'issues' && second === 'comments' && numeric(third)) {
    if (method === 'DELETE')
      return ask('apagar um comentário depois do Approve o revoga')
    if (method === 'PATCH' || method === 'POST')
      return combine([
        ask('editar um comentário depois do Approve o revoga'),
        openingDecision(fieldText(fieldOf(body, 'body'))),
      ])
    return pass()
  }

  // GitHub takes POST where it documents PATCH, as it does for comments.
  if (first === 'issues' && numeric(second) && third === undefined) {
    if (method !== 'PATCH' && method !== 'POST') return pass()
    if (body === unknown)
      return unread(
        'não consegui ler o que o gh api muda na issue: confira que não são as labels nem a reabertura',
      )
    const decisions = []
    // `labels` replaces every label: naming a state label writes it, and
    // leaving it out drops the one the issue has. Either way it is a state
    // label write, so any `labels` field is refused.
    if (fieldOf(body, 'labels').present)
      decisions.push(
        deny(
          `o campo labels troca todas as labels da issue, a de estado inclusive: ${apiLabelRule}`,
        ),
      )
    const state = fieldOf(body, 'state')
    if (state.present && !state.known)
      decisions.push(
        unread('não consegui ler o estado que o gh api põe na issue'),
      )
    else if (state.present && String(state.value).toLowerCase() === 'open')
      decisions.push(deny('reabrir uma issue cancela o Approve e é do dono'))
    const text = fieldText(fieldOf(body, 'body'))
    if (fieldOf(body, 'body').present)
      decisions.push(
        ask('editar o corpo da issue depois do Approve o revoga'),
        openingDecision(text),
      )
    return combine(decisions)
  }

  // Spec silent: creating an issue through the API is held to the rules of
  // gh issue create.
  if (first === 'issues' && second === undefined && method !== 'GET') {
    const names = labelNames(body)
    return combine([
      openingDecision(fieldText(fieldOf(body, 'body'))),
      names === unknown
        ? unread(unknownLabels)
        : createLabels(names.map((name) => ({ name, known: true }))),
    ])
  }

  // Spec silent: the label itself, as gh label create, edit and delete.
  if (first === 'labels') {
    const names = [
      second === undefined
        ? fieldOf(body, 'name')
        : { present: true, known: true, value: decode(second) },
      fieldOf(body, 'new_name'),
    ].filter((field) => field.present)
    if (names.some((field) => !field.known)) return unread(unknownLabels)
    if (
      names.some((field) => isState(String(field.value).trim().toLowerCase()))
    )
      return deny(
        'as labels de estado são do contrato do loop: o agente não as cria, renomeia nem apaga',
      )
    return pass()
  }

  if (first === 'pulls' && numeric(second) && third === 'merge')
    return method === 'GET'
      ? pass()
      : deny(
          'use gh pr merge: ele confere os checks, a revisão do Copilot e as threads antes',
        )

  // Spec silent: a PR created or edited through the API is held to the
  // rules of gh pr create and gh pr edit.
  if (first === 'pulls' && second === undefined && method !== 'GET')
    return apiPrCreate(
      fieldOf(body, 'head'),
      fieldOf(body, 'body'),
      fieldOf(body, 'title'),
    )
  if (first === 'pulls' && numeric(second) && third === undefined) {
    if (method === 'GET') return pass()
    const text = fieldText(fieldOf(body, 'body'))
    const heading = fieldText(fieldOf(body, 'title'))
    return combine([
      skipDecision([heading.text, text.text], 'a PR', {
        unknown: !heading.known,
        unread: 'o título da PR',
      }),
      text.known && text.text !== null
        ? closesDecision(text.text, null, 'da PR')
        : text.known
          ? pass()
          : unread(
              'não consegui ler o novo corpo da PR para conferir a primeira linha',
            ),
    ])
  }

  // Spec silent: writes that land on main without a pull request.
  if (method !== 'GET') {
    const trunkRef = `heads/${trunk}`
    if (first === 'merges') {
      const base = fieldOf(body, 'base')
      if (
        !base.known ||
        base.value === trunk ||
        base.value === `refs/${trunkRef}`
      )
        return deny(`merge em ${trunk} pela API: a mudança entra por PR`)
    }
    if (first === 'git' && second === 'refs') {
      const ref = [third, ...more].join('/')
      const named = fieldOf(body, 'ref')
      if (
        ref === trunkRef ||
        (named.present && (!named.known || named.value === `refs/${trunkRef}`))
      )
        return deny(`escrever em ${trunk} pela API: a mudança entra por PR`)
    }
    if (first === 'contents') {
      const branch = fieldOf(body, 'branch')
      if (!branch.present || !branch.known || branch.value === trunk)
        return deny(
          `um commit pela API sem branch cai em ${trunk}: a mudança entra por PR`,
        )
    }
  }
  return pass()
}

/** Mutations that write labels by node id, which the hook cannot map to names. */
const labelMutations = [
  'addLabelsToLabelable',
  'removeLabelsFromLabelable',
  'clearLabelsFromLabelable',
]
const resolveThreadMutation = 'resolveReviewThread'
const mergeMutations = ['mergePullRequest', 'enablePullRequestAutoMerge']

/** The mutation names the tripwire looks for in an indirection (guard-bash). */
export const tripwireMutations = [
  labelMutations[0],
  resolveThreadMutation,
  mergeMutations[0],
]

/**
 * The query as GraphQL reads its tokens: comments dropped and commas, which
 * GraphQL ignores, turned into spaces, strings kept as they are. So a name
 * followed by `,` or by a comment before its `(` is still a call.
 */
function graphqlTokens(query) {
  let out = ''
  let k = 0
  while (k < query.length) {
    if (query.startsWith('"""', k)) {
      let end = query.indexOf('"""', k + 3)
      while (end > 0 && query[end - 1] === '\\')
        end = query.indexOf('"""', end + 3)
      const stop = end < 0 ? query.length : end + 3
      out += query.slice(k, stop)
      k = stop
      continue
    }
    const c = query[k]
    if (c === '"') {
      let j = k + 1
      while (j < query.length && query[j] !== '"' && query[j] !== '\n')
        j += query[j] === '\\' ? 2 : 1
      out += query.slice(k, j + 1)
      k = j + 1
      continue
    }
    if (c === '#') {
      while (k < query.length && query[k] !== '\n' && query[k] !== '\r') k += 1
      out += ' '
      continue
    }
    out += c === ',' ? ' ' : c
    k += 1
  }
  return out
}

/**
 * Where each call of a mutation starts its arguments: the text between the
 * parentheses after its name, skipping string literals.
 */
function callsOf(query, name) {
  const calls = []
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g')
  for (const match of query.matchAll(pattern)) {
    let depth = 1
    let k = match.index + match[0].length
    const start = k
    while (k < query.length && depth > 0) {
      if (query.startsWith('"""', k)) {
        const end = query.indexOf('"""', k + 3)
        k = end < 0 ? query.length : end + 3
        continue
      }
      const c = query[k]
      if (c === '"') {
        k += 1
        while (k < query.length && query[k] !== '"')
          k += query[k] === '\\' ? 2 : 1
        k += 1
        continue
      }
      if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      k += 1
    }
    calls.push(query.slice(start, depth === 0 ? k - 1 : k))
  }
  return calls
}

/** Where `key:` sits in GraphQL arguments, outside string literals, or -1. */
function keyAt(args, key) {
  let k = 0
  while (k < args.length) {
    if (args.startsWith('"""', k)) {
      const end = args.indexOf('"""', k + 3)
      k = end < 0 ? args.length : end + 3
      continue
    }
    if (args[k] === '"') {
      k += 1
      while (k < args.length && args[k] !== '"') k += args[k] === '\\' ? 2 : 1
      k += 1
      continue
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(args.slice(k))
    if (word !== null && (k === 0 || !/[A-Za-z0-9_$]/.test(args[k - 1]))) {
      const after = /^\s*:\s*/.exec(args.slice(k + word[0].length))
      if (word[0] === key && after !== null)
        return k + word[0].length + after[0].length
      k += word[0].length
      continue
    }
    k += 1
  }
  return -1
}

const fromVariable = (value) =>
  value === undefined || hasUnknown(value)
    ? { present: true, known: false, value: unknown }
    : { present: true, known: true, value }

/**
 * A mutation argument, inline or through a variable: `key: "text"`,
 * `key: """text"""`, `key: $var`, `key: [...]`, or `input: $var` holding
 * the key. A variable the call does not send could be anything, so it is
 * unknown.
 */
function argumentOf(args, key, variables) {
  const at = keyAt(args, key)
  if (at >= 0) {
    if (args.startsWith('"""', at)) {
      const end = args.indexOf('"""', at + 3)
      return {
        present: true,
        known: end >= 0,
        value: end >= 0 ? args.slice(at + 3, end) : unknown,
      }
    }
    if (args[at] === '"') {
      let k = at + 1
      while (k < args.length && args[k] !== '"') k += args[k] === '\\' ? 2 : 1
      try {
        return {
          present: true,
          known: true,
          value: JSON.parse(args.slice(at, k + 1)),
        }
      } catch {
        return { present: true, known: false, value: unknown }
      }
    }
    if (args[at] === '$') {
      const name = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(args.slice(at))?.[1]
      return fromVariable(variables?.[name])
    }
    const token = /^[^\s,)}]+/.exec(args.slice(at))?.[0] ?? ''
    return { present: true, known: true, value: token }
  }
  const input = /(?:^|[\s,{(])input\s*:\s*\$([A-Za-z_][A-Za-z0-9_]*)/.exec(args)
  if (input !== null) {
    const value = variables?.[input[1]]
    if (value === undefined || value === unknown)
      return { present: true, known: false, value: unknown }
    if (value !== null && typeof value === 'object' && key in value)
      return fromVariable(value[key])
  }
  return { present: false, known: true, value: undefined }
}

function resolveThread(args, variables, github) {
  const id = argumentOf(args, 'threadId', variables)
  if (!id.present || !id.known || typeof id.value !== 'string')
    return unread(
      'não consegui ler a thread que o resolveReviewThread resolve: confira que você respondeu nela antes',
    )
  const author = github.threadLastAuthor(id.value)
  const viewer = author.ok ? github.viewer() : author
  if (!author.ok || !viewer.ok)
    return unread(
      `não consegui confirmar que a última resposta da thread é sua (${(author.ok ? viewer : author).reason})`,
    )
  if (
    author.value !== null &&
    author.value.toLowerCase() === viewer.value.toLowerCase()
  )
    return pass()
  return deny(
    `responda na thread antes de resolvê-la: o último comentário é de ${author.value ?? 'uma conta apagada'}, não de ${viewer.value}`,
  )
}

function graphqlDecision(body, ctx) {
  if (body === unknown)
    return unread(
      'não consegui ler a chamada GraphQL do gh api: confira o que ela muda',
    )
  const raw = body?.query
  if (raw === unknown || hasUnknown(raw))
    return unread(
      'não consegui ler a query GraphQL: confira que ela não é uma mutation do loop',
    )
  if (typeof raw !== 'string') return pass()
  const query = graphqlTokens(raw)
  if (!/\bmutation\b/.test(query)) return pass()
  const variables =
    body.variables !== null && typeof body.variables === 'object'
      ? body.variables
      : body
  const decisions = []
  const each = (name, rule) => {
    for (const args of callsOf(query, name)) decisions.push(rule(args))
  }
  const text = (args, key) => {
    const field = argumentOf(args, key, variables)
    return fieldText(field)
  }
  each('addComment', (args) => openingDecision(text(args, 'body')))
  each('updateIssueComment', (args) =>
    combine([
      ask('editar um comentário depois do Approve o revoga'),
      openingDecision(text(args, 'body')),
    ]),
  )
  each('deleteIssueComment', () =>
    ask('apagar um comentário depois do Approve o revoga'),
  )
  for (const name of labelMutations)
    each(name, () =>
      deny('labels por id não são conferidas: use gh issue edit'),
    )
  each('updateIssue', (args) => {
    const inner = []
    if (argumentOf(args, 'labelIds', variables).present)
      inner.push(deny('labels por id não são conferidas: use gh issue edit'))
    const state = argumentOf(args, 'state', variables)
    if (state.present && !state.known)
      inner.push(
        unread('não consegui ler o estado que a mutation põe na issue'),
      )
    else if (state.present && String(state.value).toUpperCase() === 'OPEN')
      inner.push(deny('reabrir uma issue cancela o Approve e é do dono'))
    if (argumentOf(args, 'body', variables).present)
      inner.push(
        ask('editar o corpo da issue depois do Approve o revoga'),
        openingDecision(text(args, 'body')),
      )
    return combine(inner)
  })
  // Spec silent: an issue created with labels by id escapes the label rule
  // just the same.
  each('createIssue', (args) =>
    argumentOf(args, 'labelIds', variables).present
      ? deny(
          'labels por id não são conferidas: use gh issue create com --label',
        )
      : openingDecision(text(args, 'body')),
  )
  each('reopenIssue', () =>
    deny('reabrir uma issue cancela o Approve e é do dono'),
  )
  each(resolveThreadMutation, (args) =>
    resolveThread(args, variables, ctx.github),
  )
  for (const name of mergeMutations)
    each(name, () =>
      deny(
        'use gh pr merge: ele confere os checks, a revisão do Copilot e as threads antes',
      ),
    )
  // Spec silent: mergeBranch merges one branch into another with no pull
  // request, main included.
  each('mergeBranch', () =>
    deny(`merge de branch pela API: a mudança entra em ${trunk} por PR`),
  )
  // Spec silent: a PR created through GraphQL is held to the rules of gh pr
  // create, as the REST route is (Copilot review of #26). Its repository is
  // a node id the hook cannot name, so it is judged wherever the command
  // runs, like the other mutations.
  each('createPullRequest', (args) =>
    apiPrCreate(
      argumentOf(args, 'headRefName', variables),
      argumentOf(args, 'body', variables),
      argumentOf(args, 'title', variables),
    ),
  )
  // A new body keeps the Closes line, as the REST PATCH of pulls/{n} does.
  // The pull request is a node id, so its issue is not known: the shape alone.
  each('updatePullRequest', (args) => {
    const body = text(args, 'body')
    const heading = text(args, 'title')
    return combine([
      skipDecision([heading.text, body.text], 'a PR', {
        unknown: !heading.known,
        unread: 'o título da PR',
      }),
      !body.known
        ? unread(
            'não consegui ler o novo corpo da PR para conferir a primeira linha',
          )
        : body.text !== null
          ? closesDecision(body.text, null, 'da PR')
          : pass(),
    ])
  })
  return combine(decisions)
}

/** The methods a write may use: a method that cannot be read is judged as each of them. */
const writeMethods = ['POST', 'PATCH', 'PUT', 'DELETE']

/** gh api's placeholders: `{owner}`, `{repo}`, `{branch}` and their `:owner` spellings. */
const placeholder = /:(?:owner|repo|branch)\b|\{[a-z]+\}/

/**
 * The repository gh fills `{owner}` and `{repo}` with: GH_REPO, else the one
 * around the command's directory, with the git config the command gives it
 * (remotesRepo). null when neither can be read.
 */
function placeholderRepo(command, ctx) {
  const env = ghRepoEnv(command, ctx)
  if (env !== null) return env.repo
  const remote = remotesRepo(command, ctx)
  return remote.unknown ? null : remote.repo
}

function apiDecision(command, base, from) {
  const request = apiRequest(command, base, from)
  if (request.method === 'GET') return pass()
  // Another host is another GitHub; one that cannot be read may be this one.
  const host = request.host ?? envOf(command, base).GH_HOST ?? null
  const spelled = typeof host === 'string' && host.trim() !== ''
  const hostKnown = !spelled || !/[$`]/.test(host)
  if (spelled && hostKnown && normalHost(host) !== 'github.com') return pass()
  // What is judged here is github.com, where the call goes when its host is
  // github.com or none is set: a live read goes there too, and nowhere for
  // a host that cannot be read (Copilot review of #26, fifth round).
  const ctx = extend(base, {
    github: clientAt(base, hostKnown ? projectHost : null),
  })
  const endpoint = request.endpoint
  if (endpoint === null) return pass()
  if (!endpoint.known)
    return unread(
      `não consegui ler o endpoint do gh api em "${endpoint.value}": confira o que ele escreve`,
    )
  const raw = endpoint.value
    .replace(/^https?:\/\/api\.github\.com\//i, '')
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '')
  // GraphQL names no repository: its node ids are global, so a mutation is
  // judged wherever the command runs.
  if (raw.split('/')[0] === 'graphql')
    return judgeBodies(bodiesOf(request, { graphql: true }), (body) =>
      graphqlDecision(body, ctx),
    )
  // The repository around the command is read only when a placeholder
  // needs it. A placeholder left unfilled could be this project.
  let segments = raw.split('/').filter((segment) => segment !== '')
  if (placeholder.test(raw)) {
    const [owner, name] = (placeholderRepo(command, ctx) ?? '').split('/')
    segments = segments.map((segment) =>
      segment
        .replace(/:owner\b|\{owner\}/g, owner || '{owner}')
        .replace(/:repo\b|\{repo\}/g, name || '{repo}'),
    )
  }
  if (segments[0] !== 'repos' || segments.length < 3) return pass()
  const pair = `${segments[1]}/${segments[2]}`
  if (!placeholder.test(pair) && !isProject(pair)) return pass()
  const methods = request.method === 'UNKNOWN' ? writeMethods : [request.method]
  return judgeBodies(bodiesOf(request), (body) =>
    combine(
      methods.map((method) => restDecision(method, segments.slice(3), body)),
    ),
  )
}

// ---------------------------------------------------------------------------
// The entry

const handlers = {
  'issue comment': issueComment,
  'issue create': issueCreate,
  'issue edit': issueEdit,
  'issue close': issueClose,
  'label create': labelChange,
  'label edit': labelChange,
  'label delete': labelChange,
  'issue reopen': () =>
    deny('reabrir uma issue cancela o Approve e é do dono: peça ao dono'),
  'repo edit': () =>
    deny('gh repo edit muda as configurações do repositório, que são do dono'),
  'pr create': prCreate,
  'pr edit': prEdit,
  'pr merge': prMerge,
}

/**
 * Decision (or Promise of one) for one SimpleCommand whose argv[0] is 'gh'.
 * ctx = { cwd: the command's directory, absolute; repo: repoAt of it (read
 * only when a rule needs it); permissionMode; githubFor: host -> client
 * (githubClients()), or github: one client for every read }.
 * A handler also gets `target`, the repository the command acts on, this
 * project when it cannot be read, and `targetKnown`, false then: a rule
 * that would pass on a live read of this project asks instead, naming
 * `targetWhy` when there is one (seventh round). Its `github` reads the
 * host the command goes to (Copilot review of #26, fifth round): github.com
 * for this project, nothing when the target cannot be read.
 */
export async function ghDecision(command, ctx) {
  const [group, verb] = leadingWords(command)
  if (group === undefined) return pass()
  if (!group.known)
    return unread(
      `não consegui ler o subcomando do gh em "${group.value}": confira o que ele faz`,
    )
  // One factory of clients for the command and the aliases it runs: the
  // client itself is chosen once the command's host is known.
  const local =
    typeof ctx.githubFor === 'function' || ctx.github != null
      ? ctx
      : extend(ctx, { githubFor: githubClients() })
  if (group.value === 'api') return apiDecision(command, local, group.index + 1)
  if (!ghCommands.has(group.value)) return aliasUse(command, local, group)
  if (verb === undefined) return pass()
  const key = `${group.value} ${verbAliases.get(verb.value) ?? verb.value}`
  if (
    !verb.known &&
    ['issue', 'pr', 'repo', 'alias', 'label'].includes(group.value)
  )
    return unread(
      `não consegui ler o subcomando do gh em "${group.value} ${verb.value}": confira o que ele faz`,
    )
  if (key === 'alias set') return aliasSet(command, local, verb.index + 1)
  if (key === 'alias import') return aliasImport(command, local, verb.index + 1)
  const handler = handlers[key]
  if (handler === undefined) return pass()
  const operands = operandsOf(command, verb.index + 1, valuedFlags[key])
  const target =
    key === 'repo edit' && operands[0] !== undefined
      ? operands[0].known
        ? { repo: repoFromArg(operands[0].value), unknown: false }
        : { repo: null, unknown: true }
      : targetOf(command, local, operands)
  if (!target.unknown && !isProject(target.repo)) return pass()
  return handler(
    command,
    extend(local, {
      operands,
      target: target.repo ?? projectRepo,
      targetKnown: !target.unknown,
      targetWhy: target.why ?? null,
      // This project is on github.com: a target that could be read as it is
      // there, whatever GH_HOST the hook inherits; one that could not, read
      // nowhere.
      github: clientAt(local, target.unknown ? null : projectHost),
    }),
  )
}
