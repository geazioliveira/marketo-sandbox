#!/usr/bin/env node
// The audit of main: every change that reaches main, judged after the fact
// against the loop's rule that it comes through a pull request that closes an
// issue and was merged with the required checks green (#3).
//
// Why after the fact: on GitHub Free nothing on the server can block a direct
// push, a web edit or a merge outside the loop
// (context/decisions/0002-soft-enforcement-on-github-free.md). What is left is
// that nothing lands unrecorded: .github/workflows/main-audit.yml runs this on
// every push to main, once a day and on demand. Each commit found out of the
// loop gets an issue of its own (auditTitleFor, auditLabels); past
// auditIssueCap of them, one issue on the audited tip lists them all.
//
// Two steps, two modes. `--judge` (the step auditJudgeStep) judges the range,
// files the issues and leaves the count of commits out of the loop in
// RUNNER_TEMP/auditVerdictFile; it exits 0 whenever it got that far, whatever
// the count, and non-zero when it was interrupted. `--verdict` (the step
// auditVerdictStep) exits 1 when that count is above zero or missing. So a run
// whose Julgar succeeded judged its range, even when the run is red, and a run
// whose Julgar failed judged nothing to rely on.
//
// What it judges: the range from the last audited commit to the tip, along
// the tip's first parents, read from the local clone (the workflow checks main
// out with its whole history). The last audited commit is the head of the
// newest run of main-audit.yml on main older than this one (a re-run keeps its
// id, so it starts from the run before it) whose Julgar concluded success,
// among the auditRunsRead latest completed runs. So a push that started no
// run of its own (a skip token in its message, a push made with GITHUB_TOKEN,
// a run cancelled in the queue) and a run that stopped halfway are judged by
// the next audit. When that head is not an ancestor of the tip, main's history
// was rewritten since: the tip gets that reason, and the range starts at
// their common ancestor. When there is no such run, or its head is not in the
// clone, the range starts at the push's BEFORE, or at auditBaseline on a
// schedule or a dispatch, and the output says so. Merges are merge commits
// only, so a merged PR adds one first-parent commit, the merge itself; the
// branch's commits beneath it were judged on the PR and are not judged again.
// Commits reachable from auditBaseline never are.
//
// A commit is in the loop when GitHub names a merged pull request into main
// whose merge commit it is, and that PR
// - closes an issue of this repository: by closingIssuesReferences or, when
//   that holds none, by a first body line that is closesLine and names a
//   number GitHub confirms is an issue, not a pull request;
// - had every requiredChecks entry green on its head commit when it merged:
//   the latest run of that job, in a suite of that workflow, that started
//   before the merge, finished with success before it. The issue-link check
//   counts only from a suite of issueLinkWorkflowPath run on issueLinkEvent,
//   which takes the YAML from main; the quality check runs the PR's own
//   check.yml by design, so its names are all there is to match.
// A page GitHub sends incomplete is not judged either way: more than
// auditClosingPage closing references with none of this repository's issues
// among those read, or more than auditChecksPage check suites on the head, or
// check runs in one suite. Such a merge is out of the loop with that reason,
// and its issue goes to the owner: a re-run would read the same page, so this
// is no interruption.
// GitHub links a merge commit to its PR a moment after the push, so a merge
// commit it names no PR for yet is asked about again, auditLinkRetries times
// with AUDIT_RETRY_DELAY_MS before each, and only then judged a direct commit.
// A commit with one parent is never a PR's merge here, so it is not waited for.
//
// Fail-closed: a gh or git failure ends Julgar red with the reason, and the
// commits are all judged before any issue is opened. Re-running that run is
// the remedy: an issue with the same title, open or closed, is never opened
// twice. A new occurrence of a commit already on record (main forced back to
// it, say) gets a comment on that issue instead, and a re-run of the same run
// adds nothing.
//
// Input comes only from the environment: GITHUB_REPOSITORY, GITHUB_EVENT_NAME
// (push, schedule or workflow_dispatch), GITHUB_RUN_ID, RUNNER_TEMP, and for a
// push BEFORE, AFTER and FORCED ('true' or 'false'); GH_TOKEN, which gh reads.
// On a schedule or a dispatch the tip is the checked-out HEAD. AUDIT_BASELINE
// replaces the baseline and AUDIT_RETRY_DELAY_MS the wait (auditRetryDelayMs),
// for the tests. `--verdict` reads RUNNER_TEMP only.
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  auditBaseline,
  auditChecksPage,
  auditClosingPage,
  auditCommitCap,
  auditIssueCap,
  auditJudgeStep,
  auditLabels,
  auditLinkRetries,
  auditRetryDelayMs,
  auditRunsRead,
  auditTitleFor,
  auditVerdictFile,
  auditVerdictStep,
  closesLine,
  headAndRest,
  issueLinkEvent,
  issueLinkWorkflowPath,
  mainAuditWorkflowFile,
  requiredChecks,
} from './loop-sections.mjs'

const trunk = 'main'
const events = ['push', 'schedule', 'workflow_dispatch']
const hexSha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const zeroSha = /^0+$/
const repoPattern = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/
const timeoutMs = 30_000
const maxBuffer = 64 * 1024 * 1024
/**
 * Where a required check's run must come from, by job: only the issue-link
 * check has a source a PR cannot choose.
 */
const pinnedOrigins = new Map([
  ['issue-link', { event: issueLinkEvent, path: issueLinkWorkflowPath }],
])

const prQuery = `query($owner: String!, $name: String!, $number: Int!, $head: GitObjectID!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { number body closingIssuesReferences(first: ${auditClosingPage}) { totalCount nodes { number repository { nameWithOwner } } } } object(oid: $head) { ... on Commit { checkSuites(first: ${auditChecksPage}) { totalCount nodes { workflowRun { event file { path } workflow { name } } checkRuns(first: ${auditChecksPage}, filterBy: { checkType: ALL }) { totalCount nodes { name conclusion startedAt completedAt } } } } } } } }`

/** A failure that ends the audit red, with a reason a person can act on. */
class AuditError extends Error {}

const short = (sha) => String(sha ?? '').slice(0, 7)

const firstLine = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? ''

/** Blocks for `ms` milliseconds: the script is synchronous from end to end. */
function sleep(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// ---------------------------------------------------------------------------
// git and gh, both through argv (never a shell), each bounded by a timeout

function git(...args) {
  const run = spawnSync('git', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer,
  })
  return {
    ok: !run.error && run.status === 0,
    status: run.error ? null : run.status,
    out: run.stdout ?? '',
    reason: run.error
      ? String(run.error.message)
      : firstLine(run.stderr) || `saiu com status ${run.status}`,
  }
}

/** Trimmed stdout, or an AuditError naming what was being read. */
function gitOut(what, ...args) {
  const run = git(...args)
  if (!run.ok) throw new AuditError(`git falhou ao ler ${what}: ${run.reason}`)
  return run.out.trim()
}

const hasCommit = (sha) => git('cat-file', '-e', `${sha}^{commit}`).ok

/** merge-base answers 0 (yes) or 1 (no); anything else is a failure, not a no. */
function isAncestor(older, newer) {
  const run = git('merge-base', '--is-ancestor', older, newer)
  if (run.status === 0) return true
  if (run.status === 1) return false
  throw new AuditError(
    `git não conseguiu dizer se ${short(older)} é ancestral de ${short(newer)}: ${run.reason}`,
  )
}

/** How many parents a commit has: a PR's merge commit has two. */
function parentCount(sha) {
  const out = gitOut(
    `os pais de ${short(sha)}`,
    'log',
    '-1',
    '--format=%P',
    sha,
    '--',
  )
  return out === '' ? 0 : out.split(/\s+/).length
}

/** One gh call; a gh that cannot run at all is an AuditError. */
function ghRun(what, args) {
  const run = spawnSync('gh', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
    },
    timeout: timeoutMs,
    maxBuffer,
  })
  if (run.error?.code === 'ENOENT')
    throw new AuditError('gh não está instalado ou não está no PATH')
  if (run.error)
    throw new AuditError(
      run.error.code === 'ETIMEDOUT'
        ? `gh não respondeu em ${timeoutMs / 1000} s (${what})`
        : `gh falhou (${what}): ${run.error.message}`,
    )
  return run
}

const ghFailure = (what, run) =>
  new AuditError(
    `gh falhou (${what}): ${firstLine(run.stderr) || `saiu com status ${run.status}`}`,
  )

/** stdout of one gh call, or an AuditError with gh's own reason. */
function gh(what, args) {
  const run = ghRun(what, args)
  if (run.status !== 0) throw ghFailure(what, run)
  return run.stdout
}

function parseJson(what, out) {
  try {
    return JSON.parse(out)
  } catch {
    throw new AuditError(`gh não devolveu JSON (${what})`)
  }
}

const ghJson = (what, args) => parseJson(what, gh(what, args))

// ---------------------------------------------------------------------------
// Input

/** @returns {{ input: object } | { errors: string[] }} */
function readInput(env) {
  const errors = []
  const repo = String(env.GITHUB_REPOSITORY ?? '')
  const named = repoPattern.exec(repo)
  if (named === null)
    errors.push(`GITHUB_REPOSITORY deve ser dono/nome, recebeu "${repo}"`)
  const event = String(env.GITHUB_EVENT_NAME ?? '')
  if (!events.includes(event))
    errors.push(
      `GITHUB_EVENT_NAME deve ser ${events.join(', ')}, recebeu "${event}"`,
    )
  const push = event === 'push'
  // Outside a push the workflow still hands these over, empty: the tip is
  // the checked-out HEAD, and there is no push to have been forced.
  const before = String(env.BEFORE ?? '')
  const after = String(env.AFTER ?? '')
  const forced = String(env.FORCED ?? '')
  if (push) {
    for (const [key, value] of [
      ['BEFORE', before],
      ['AFTER', after],
    ])
      if (!hexSha.test(value))
        errors.push(
          `${key} deve ser o SHA completo de um commit, recebeu "${value}"`,
        )
    if (forced !== 'true' && forced !== 'false')
      errors.push(`FORCED deve ser true ou false, recebeu "${forced}"`)
  }
  const runId = String(env.GITHUB_RUN_ID ?? '')
  if (runId !== '' && !/^[1-9]\d*$/.test(runId))
    errors.push(`GITHUB_RUN_ID deve ser o id da execução, recebeu "${runId}"`)
  const baseline = env.AUDIT_BASELINE || auditBaseline
  if (!hexSha.test(baseline))
    errors.push(
      `AUDIT_BASELINE deve ser um SHA completo, recebeu "${baseline}"`,
    )
  const delay = env.AUDIT_RETRY_DELAY_MS || String(auditRetryDelayMs)
  if (!/^\d+$/.test(delay))
    errors.push(
      `AUDIT_RETRY_DELAY_MS deve ser um número de milissegundos, recebeu "${delay}"`,
    )
  const temp = String(env.RUNNER_TEMP ?? '')
  if (!path.isAbsolute(temp))
    errors.push(
      `RUNNER_TEMP deve ser o diretório temporário do runner, recebeu "${temp}"`,
    )
  if (errors.length > 0) return { errors }
  return {
    input: {
      repo,
      owner: named[1],
      name: named[2],
      event,
      push,
      before: push ? before : null,
      after: push ? after : null,
      forced: push && forced === 'true',
      runId: runId === '' ? null : Number(runId),
      baseline,
      retryDelay: Number(delay),
      verdictFile: path.join(temp, auditVerdictFile),
    },
  }
}

// ---------------------------------------------------------------------------
// The range

/** Whether a run's Julgar step concluded success, in any of its attempts. */
function judged({ repo }, id) {
  const what = `os jobs da execução ${id} da auditoria`
  const listing = ghJson(what, [
    'api',
    `repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=100`,
  ])
  if (!Array.isArray(listing?.jobs))
    throw new AuditError(`${what} não vieram numa lista`)
  return listing.jobs.some(
    (job) =>
      Array.isArray(job?.steps) &&
      job.steps.some(
        (step) =>
          step?.name === auditJudgeStep &&
          step.status === 'completed' &&
          step.conclusion === 'success',
      ),
  )
}

/**
 * The head of the newest run of main-audit.yml on main older than this one
 * whose Julgar concluded success, among the auditRunsRead latest completed;
 * null when there is none. `read` is how many runs were asked about.
 * @returns {{ last: { id: number, sha: string } | null, read: number }}
 */
function lastAudited(input) {
  const { repo, runId } = input
  const what = 'as últimas execuções da auditoria'
  const run = ghRun(what, [
    'api',
    `repos/${repo}/actions/workflows/${mainAuditWorkflowFile}/runs?branch=${trunk}&status=completed&per_page=${auditRunsRead}`,
  ])
  // GitHub knows a workflow by its file only once the file is on main: until
  // then there is no run before this one.
  if (run.status !== 0 && /\(HTTP 404\)/.test(String(run.stderr ?? '')))
    return { last: null, read: 0 }
  if (run.status !== 0) throw ghFailure(what, run)
  const listing = parseJson(what, run.stdout)
  if (!Array.isArray(listing?.workflow_runs))
    throw new AuditError('as execuções da auditoria não vieram numa lista')
  // Newest by id first, whatever order the listing came in, and only runs
  // older than this one: a re-run keeps its id and judges the range it was
  // started for, from the run before it. A later run's head may lie past this
  // run's tip, and would read as a rewrite.
  const candidates = listing.workflow_runs
    .filter(
      (candidate) =>
        candidate != null &&
        Number.isInteger(candidate.id) &&
        candidate.id > 0 &&
        (runId === null || candidate.id < runId) &&
        hexSha.test(String(candidate.head_sha ?? '')),
    )
    .sort((one, other) => other.id - one.id)
    .slice(0, auditRunsRead)
  let read = 0
  for (const candidate of candidates) {
    read += 1
    if (judged(input, candidate.id))
      return { last: { id: candidate.id, sha: candidate.head_sha }, read }
  }
  return { last: null, read }
}

/**
 * How GitHub relates the last audited head to the tip, for when the clone no
 * longer has that head: actions/checkout fetches branches and tags only, and a
 * force-push leaves the old head on no ref. GitHub still serves it to compare
 * (the PR timeline's force-push links rely on that). Null on a 404: GitHub no
 * longer knows the commit either.
 * @returns {{ status: string, mergeBase: string | null } | null}
 */
function remoteCompare({ repo }, last, after) {
  const what = `a comparação de ${short(last)} com ${short(after)}`
  const run = ghRun(what, ['api', `repos/${repo}/compare/${last}...${after}`])
  if (run.status !== 0 && /\(HTTP 404\)/.test(String(run.stderr ?? '')))
    return null
  if (run.status !== 0) throw ghFailure(what, run)
  const answer = parseJson(what, run.stdout)
  const mergeBase = answer?.merge_base_commit?.sha
  return {
    status: String(answer?.status ?? ''),
    mergeBase: hexSha.test(String(mergeBase ?? '')) ? mergeBase : null,
  }
}

/** The best common ancestor of two commits; null when they share none. */
function mergeBase(one, other) {
  const run = git('merge-base', one, other)
  if (run.status === 1 && run.out.trim() === '') return null
  const sha = run.out.trim()
  if (run.status !== 0 || !hexSha.test(sha))
    throw new AuditError(
      `git não conseguiu achar o ancestral comum de ${short(one)} e ${short(other)}: ${run.reason}`,
    )
  return sha
}

/** First-parent commits of AFTER not reachable from any of `exclude`. */
function countRange(after, exclude) {
  const out = gitOut(
    `o intervalo até ${short(after)}`,
    'rev-list',
    '--count',
    '--first-parent',
    after,
    ...exclude.map((sha) => `^${sha}`),
    '--',
  )
  const count = Number(out)
  if (!Number.isInteger(count) || count < 0)
    throw new AuditError(`git rev-list --count devolveu "${out}"`)
  return count
}

/** The same commits, oldest first. */
function listRange(after, exclude) {
  const out = gitOut(
    `o intervalo até ${short(after)}`,
    'rev-list',
    '--first-parent',
    '--reverse',
    after,
    ...exclude.map((sha) => `^${sha}`),
    '--',
  )
  const shas = out === '' ? [] : out.split('\n').map((line) => line.trim())
  if (!shas.every((sha) => hexSha.test(sha)))
    throw new AuditError('git rev-list devolveu uma linha que não é SHA')
  return shas
}

// ---------------------------------------------------------------------------
// One commit

const direct = 'commit direto em main, sem PR'

/** The merged PR into main whose merge commit is `sha`, if GitHub names one. */
function linkedPull({ repo }, sha) {
  const pulls = ghJson(`as PRs do commit ${short(sha)}`, [
    'api',
    `repos/${repo}/commits/${sha}/pulls?per_page=100`,
  ])
  if (!Array.isArray(pulls))
    throw new AuditError(`as PRs do commit ${short(sha)} não vieram numa lista`)
  // The PR whose merge is this very commit: a branch commit pushed straight
  // to main is associated with its PR too, but it is not that PR's merge.
  return pulls.find(
    (candidate) =>
      candidate != null &&
      candidate.merged_at != null &&
      candidate.base?.ref === trunk &&
      candidate.merge_commit_sha === sha,
  )
}

/**
 * What #number is here, by GET issues/{number}: 'issue'; 'pr', since GitHub
 * serves a pull request there too, with a pull_request key; or 'none', for a
 * number with nothing behind it (404), a deleted issue (410) or one moved to
 * another repository.
 */
function issueKind({ repo }, number) {
  const what = `a #${number} da primeira linha do corpo`
  const run = ghRun(what, ['api', `repos/${repo}/issues/${number}`])
  if (run.status !== 0) {
    if (/\(HTTP (?:404|410)\)/.test(String(run.stderr ?? ''))) return 'none'
    throw ghFailure(what, run)
  }
  const issue = parseJson(what, run.stdout)
  if (issue == null || typeof issue !== 'object' || issue.number !== number)
    return 'none'
  return Object.hasOwn(issue, 'pull_request') ? 'pr' : 'issue'
}

/** Whether a check suite's workflow run is where `check` must come from. */
function fromOrigin(suite, { workflow, job }) {
  const run = suite?.workflowRun
  if (run?.workflow?.name !== workflow) return false
  const pinned = pinnedOrigins.get(job)
  return (
    pinned === undefined ||
    (run.event === pinned.event && run.file?.path === pinned.path)
  )
}

/**
 * Whether `check` was green on the PR's head when it merged: the latest run of
 * that job, in a suite of that workflow from its origin, that started before
 * the merge, and every run that started with it, finished with success before
 * the merge.
 */
function greenAtMerge(suites, check, mergedAt) {
  const { job } = check
  const runs = suites
    .filter((suite) => fromOrigin(suite, check))
    .flatMap((suite) =>
      Array.isArray(suite.checkRuns?.nodes) ? suite.checkRuns.nodes : [],
    )
    .filter((run) => run?.name === job)
    .map((run) => ({
      conclusion: run.conclusion,
      started: Date.parse(run.startedAt ?? ''),
      completed: Date.parse(run.completedAt ?? ''),
    }))
    .filter((run) => run.started <= mergedAt)
  if (runs.length === 0) return false
  const latest = Math.max(...runs.map((run) => run.started))
  return runs
    .filter((run) => run.started === latest)
    .every((run) => run.conclusion === 'SUCCESS' && run.completed <= mergedAt)
}

/**
 * Whether a merged PR into main keeps its merge in the loop.
 * @returns {{ ok: true, text: string } | { ok: false, reasons: string[] }}
 */
function judgePull(input, sha, pr) {
  const { owner, name, repo } = input
  if (!Number.isInteger(pr.number) || pr.number < 1)
    throw new AuditError(`a PR do commit ${short(sha)} veio sem número`)
  const number = pr.number
  const head = String(pr.head?.sha ?? '')
  if (!hexSha.test(head))
    throw new AuditError(`a PR #${number} veio sem o SHA da head`)
  const mergedAt = Date.parse(String(pr.merged_at))
  if (Number.isNaN(mergedAt))
    throw new AuditError(`a PR #${number} veio sem a data do merge`)

  const payload = ghJson(`a PR #${number} e os checks da head`, [
    'api',
    'graphql',
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${number}`,
    '-f',
    `head=${head}`,
    '-f',
    `query=${prQuery}`,
  ])
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  const node = payload?.data?.repository?.pullRequest
  if (errors.length > 0 || node == null)
    throw new AuditError(
      `a consulta da PR #${number} falhou: ${firstLine(errors[0]?.message) || 'sem dados'}`,
    )
  // No commit behind the head (null) holds no check at all.
  const suites = payload.data.repository.object?.checkSuites
  const suiteNodes = Array.isArray(suites?.nodes) ? suites.nodes : []

  const reasons = []
  // An issue of another repository closes nothing here.
  const references = node.closingIssuesReferences
  const referenceNodes = Array.isArray(references?.nodes)
    ? references.nodes
    : []
  const closing = referenceNodes
    .filter(
      (issue) =>
        String(issue?.repository?.nameWithOwner ?? '').toLowerCase() ===
        repo.toLowerCase(),
    )
    .map((issue) => `#${issue.number}`)
  // One issue of this repository on the page is enough to close one, and the
  // unread references cannot undo that. A page with none that is not the
  // whole list says nothing about the rest, and a re-run would read the same
  // page: the merge is out of the loop for that reason, and its issue goes to
  // the owner. The first body line is not asked then, as it only counts when
  // the references hold none.
  const referenceTotal = Number(references?.totalCount ?? 0)
  const referencesUnread =
    closing.length === 0 && referenceTotal > referenceNodes.length
  let closes = closing.length > 0 ? `fecha ${closing.join(', ')}` : null
  if (referencesUnread)
    reasons.push(
      `PR #${number}: mais de ${auditClosingPage} referências de fechamento, não lidas todas, e nenhuma das lidas é issue deste repositório`,
    )
  else if (closes === null) {
    const line = closesLine.exec(headAndRest(node.body).head)
    if (line === null) reasons.push(`PR #${number} não fecha issue`)
    else {
      // GitHub adds no closing reference for a number that is a PR or
      // nothing at all, so that is exactly when this line is reached.
      const cited = Number(line[1])
      const kind = issueKind(input, cited)
      if (kind === 'issue')
        closes = `fecha #${cited} pela primeira linha do corpo`
      else
        reasons.push(
          `PR #${number} não fecha issue: a primeira linha do corpo cita #${cited}, que ${kind === 'pr' ? 'é uma PR' : 'não é uma issue deste repositório'}`,
        )
    }
  }
  // Checks on an unread page may hold the latest run of a required job, so a
  // partial page is judged neither green nor red: the merge is out of the
  // loop for that reason alone, like the references above.
  const suitesUnread = Number(suites?.totalCount ?? 0) > suiteNodes.length
  const runsUnread = suiteNodes.some(
    (suite) =>
      Number(suite?.checkRuns?.totalCount ?? 0) >
      (Array.isArray(suite?.checkRuns?.nodes) ? suite.checkRuns.nodes : [])
        .length,
  )
  if (suitesUnread)
    reasons.push(
      `PR #${number}: mais de ${auditChecksPage} check suites na head ${short(head)}, não lidas todas`,
    )
  if (runsUnread)
    reasons.push(
      `PR #${number}: mais de ${auditChecksPage} check runs numa check suite da head ${short(head)}, não lidos todos`,
    )
  if (!suitesUnread && !runsUnread)
    for (const check of requiredChecks)
      if (!greenAtMerge(suiteNodes, check, mergedAt))
        reasons.push(
          `PR #${number} mergeada sem ${check.workflow} / ${check.job} verde`,
        )
  if (reasons.length > 0) return { ok: false, reasons }
  return { ok: true, text: `PR #${number}, ${closes}, checks exigidos verdes` }
}

// ---------------------------------------------------------------------------
// The audit

/**
 * Judges the range. Reads only; opens nothing.
 * @returns {{ range: object, audited: string[], notes: string[], offenders: Map<string, string[]> }}
 */
function audit(input) {
  const { push, before, forced, baseline } = input
  const notes = []
  const tipReasons = []

  const after = push
    ? input.after
    : gitOut('o HEAD do checkout', 'rev-parse', '--verify', 'HEAD^{commit}')
  if (!hexSha.test(after))
    throw new AuditError(`o HEAD do checkout não é um SHA: "${after}"`)
  if (!hasCommit(after))
    throw new AuditError(
      `${short(after)} (AFTER) não está no clone: o checkout precisa de fetch-depth: 0`,
    )
  const range = {
    after,
    lower: null,
    from: '',
    compare: false,
    push,
    before,
    fastForward: true,
  }
  const beforeKnown = push && hasCommit(before)
  if (push) {
    range.fastForward = beforeKnown && isAncestor(before, after)
    if (forced)
      tipReasons.push(
        `force-push em main (o topo anterior era ${short(before)})`,
      )
    else if (!range.fastForward)
      tipReasons.push(
        `o histórico de main foi reescrito: o topo anterior ${short(before)} não é ancestral de ${short(after)}`,
      )
  }
  const result = (audited, offenders) => {
    if (tipReasons.length > 0)
      offenders.set(after, [...tipReasons, ...(offenders.get(after) ?? [])])
    return { range, audited, notes, offenders }
  }

  const { last, read } = lastAudited(input)
  let lowerKnown = true
  if (last !== null && hasCommit(last.sha)) {
    const at = `execução ${last.id}, em ${short(last.sha)}`
    if (isAncestor(last.sha, after)) {
      range.lower = last.sha
      range.from = `desde a última auditoria (execução ${last.id})`
    } else {
      // Main was rewritten since the last audit, by this push or by one that
      // started no run: say so on the tip, and judge everything the rewrite
      // brought, from where the two histories part.
      tipReasons.push(
        `histórico de main reescrito desde a última auditoria (${at})`,
      )
      range.lower = mergeBase(last.sha, after)
      if (range.lower === null)
        notes.push(
          `A última auditoria (${at}) não tem ancestral comum com ${short(after)}: o intervalo é a história de main até ${short(after)}.`,
        )
      else {
        range.from = `desde o ancestral comum com a última auditoria (${at})`
        notes.push(
          `A última auditoria (${at}) não é ancestral de ${short(after)}: o intervalo começa no ancestral comum, ${short(range.lower)}.`,
        )
      }
    }
  } else {
    const at = last === null ? '' : `execução ${last.id}, em ${short(last.sha)}`
    const compared =
      last === null ? null : remoteCompare(input, last.sha, after)
    const rewritten =
      compared !== null &&
      (compared.status === 'diverged' || compared.status === 'behind') &&
      compared.mergeBase !== null &&
      hasCommit(compared.mergeBase)
    const why =
      last === null
        ? `Nenhuma execução anterior da auditoria em main concluiu o passo ${auditJudgeStep} (${read} consultada(s))`
        : `A última auditoria (${at}) não está no clone e o GitHub não a relaciona com ${short(after)}`
    // Older runs exist and none finished judging: their ranges were never
    // judged, and BEFORE would drop them. Start from the baseline instead;
    // titles are deduplicated and the commit cap bounds the range.
    const lostRuns = last === null && read > 0
    if (rewritten) {
      tipReasons.push(
        `histórico de main reescrito desde a última auditoria (${at})`,
      )
      range.lower = compared.mergeBase
      range.from = `desde o ancestral comum com a última auditoria (${at})`
      notes.push(
        `A última auditoria (${at}) não está no clone; pelo GitHub ela não é ancestral de ${short(after)}: o intervalo começa no ancestral comum, ${short(range.lower)}.`,
      )
    } else if (push && !lostRuns) {
      range.lower = before
      range.from = 'desde o topo anterior do push'
      lowerKnown = beforeKnown
      notes.push(
        `${why}: o intervalo começa no topo anterior do push, ${short(before)}.`,
      )
    } else {
      range.lower = baseline
      range.from = 'desde a base da auditoria'
      lowerKnown = hasCommit(baseline)
      notes.push(
        `${why}: o intervalo começa na base da auditoria, ${short(baseline)}.`,
      )
    }
  }

  if (push && range.lower === before && !beforeKnown) {
    // A force-push leaves the old tip unreachable, so the clone does not have
    // it: which commits the push brought cannot be computed. The new tip is
    // recorded; the rest is the owner's to read.
    notes.push(
      `O intervalo ${short(before)}..${short(after)} não pode ser calculado: ${short(before)} não está no clone. Só o topo novo fica registrado.`,
    )
    return result([], new Map())
  }

  const baselineKnown = hasCommit(baseline)
  if (!baselineKnown)
    notes.push(
      `A base da auditoria ${short(baseline)} não está no clone: nenhum commit do intervalo fica de fora por ela.`,
    )
  if (!lowerKnown) range.lower = null
  const bound = range.lower === null ? [] : [range.lower]
  const exclude =
    baselineKnown && range.lower !== baseline ? [...bound, baseline] : bound
  range.compare = range.lower !== null && isAncestor(range.lower, after)
  const total = countRange(after, bound)
  const auditable = countRange(after, exclude)
  if (total > auditable)
    notes.push(
      `${total - auditable} commit(s) do intervalo vão até a base da auditoria (${short(baseline)}) e não são auditados.`,
    )

  if (auditable > auditCommitCap) {
    // A range that big is out of the loop as a whole: record it once rather
    // than ask GitHub about every commit.
    notes.push(
      `Limite de ${auditCommitCap} commits por auditoria excedido (${auditable}): a auditoria commit a commit não foi feita.`,
    )
    return result(
      [],
      new Map([
        [
          after,
          [
            `o intervalo auditado trouxe ${auditable} commits a main pelo primeiro pai, acima do limite de ${auditCommitCap}, e nenhum foi auditado um a um`,
          ],
        ],
      ]),
    )
  }

  const shas = listRange(after, exclude)
  const verdicts = new Map()
  let waiting = []
  for (const sha of shas) {
    const pr = linkedPull(input, sha)
    if (pr !== undefined) verdicts.set(sha, judgePull(input, sha, pr))
    else if (parentCount(sha) > 1) waiting.push(sha)
    else verdicts.set(sha, { ok: false, reasons: [direct] })
  }
  // GitHub links a merge to its PR a moment after the push: ask again.
  for (
    let round = 1;
    round <= auditLinkRetries && waiting.length > 0;
    round += 1
  ) {
    sleep(input.retryDelay)
    const still = []
    for (const sha of waiting) {
      const pr = linkedPull(input, sha)
      if (pr === undefined) still.push(sha)
      else verdicts.set(sha, judgePull(input, sha, pr))
    }
    waiting = still
  }
  for (const sha of waiting) {
    notes.push(
      `GitHub não ligou o merge ${short(sha)} a nenhuma PR depois de ${auditLinkRetries + 1} consultas.`,
    )
    verdicts.set(sha, { ok: false, reasons: [direct] })
  }

  const audited = []
  const offenders = new Map()
  for (const sha of shas) {
    const verdict = verdicts.get(sha)
    if (verdict.ok) audited.push(`- ${short(sha)}: ${verdict.text}`)
    else {
      audited.push(`- ${short(sha)}: ${verdict.reasons.join('; ')}`)
      offenders.set(sha, verdict.reasons)
    }
  }
  return result(audited, offenders)
}

// ---------------------------------------------------------------------------
// The issues

function repoUrl({ repo }) {
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com'
  return `${server}/${repo}`
}

/** What happened: one commit and its reasons, or every commit of the group. */
function describe(input, sha, listed) {
  const base = repoUrl(input)
  const link = (commit) => `[\`${short(commit)}\`](${base}/commit/${commit})`
  if (listed.length === 1 && listed[0][0] === sha)
    return [
      `O commit ${link(sha)} chegou em \`main\` fora do loop:`,
      '',
      ...listed[0][1].map((why) => `- ${why}.`),
    ]
  return [
    `A auditoria encontrou ${listed.length} commits fora do loop, mais que o limite de ${auditIssueCap} issues por execução. Esta issue, no topo auditado ${link(sha)}, registra todos:`,
    '',
    ...listed.map(
      ([commit, reasons]) => `- ${link(commit)}: ${reasons.join('; ')}.`,
    ),
  ]
}

/** Which range, which event, which run. */
function where(input, range) {
  const base = repoUrl(input)
  const { after, lower } = range
  const lines = []
  if (range.push && !range.fastForward)
    lines.push(
      `Push auditado: o topo de \`main\` passou de \`${short(range.before)}\` para [\`${short(after)}\`](${base}/commit/${after}).`,
    )
  if (range.compare)
    lines.push(
      `Intervalo auditado: \`${short(lower)}..${short(after)}\`, ${range.from} ([comparação](${base}/compare/${lower}...${after})).`,
    )
  else if (lower === null)
    lines.push(
      `Intervalo auditado: a história de \`main\` até [\`${short(after)}\`](${base}/commit/${after}), pelo primeiro pai.`,
    )
  lines.push(`Evento: \`${input.event}\`.`)
  if (input.runId !== null)
    lines.push(`Execução da auditoria: ${base}/actions/runs/${input.runId}`)
  return lines.flatMap((line, i) => (i === 0 ? [line] : ['', line]))
}

function issueBody(input, sha, listed, range) {
  const base = repoUrl(input)
  return [
    '## O que acontece',
    '',
    ...describe(input, sha, listed),
    '',
    ...where(input, range),
    '',
    '## A regra',
    '',
    `Toda mudança em \`main\` vem de uma PR que fecha uma issue, mergeada por merge commit com os checks exigidos verdes ([fluxo de desenvolvimento](${base}/blob/main/docs/development/workflow.md#pull-requests-e-merge)). No plano Free o GitHub não bloqueia um push direto, uma edição pela web nem um merge fora do loop, então a auditoria de \`main\` deixa este registro ([ADR 0002](${base}/blob/main/context/decisions/0002-soft-enforcement-on-github-free.md)).`,
    '',
    '## O que o dono decide',
    '',
    '- **Registrar retroativamente**: ligar a mudança a uma issue que explique o porquê, citar este commit nela e fechar esta issue com o link.',
    '- **Reverter**: fazer a reversão pelo loop, numa issue com plano e Approve, e fechar esta issue com o link da PR.',
    '',
    'Aberta automaticamente pela auditoria de `main` (`scripts/audit-main.mjs`). Só o dono move a label de estado.',
    '',
  ].join('\n')
}

function occurrenceBody(input, sha, listed, range) {
  return [
    '## Nova ocorrência',
    '',
    'A auditoria de `main` chegou a este registro de novo, numa execução que não é a que abriu a issue:',
    '',
    ...describe(input, sha, listed),
    '',
    ...where(input, range),
    '',
    'O dono decide como antes: registrar retroativamente ou reverter, pelo loop. Comentário automático da auditoria de `main` (`scripts/audit-main.mjs`).',
    '',
  ].join('\n')
}

/** Whether the issue's body or a comment already links this very run. */
function mentionsRun(issue, runId) {
  if (runId === null) return false
  const link = new RegExp(`/actions/runs/${runId}(?!\\d)`)
  const texts = [
    issue.body,
    ...(Array.isArray(issue.comments) ? issue.comments : []).map(
      (comment) => comment?.body,
    ),
  ]
  return texts.some((text) => link.test(String(text ?? '')))
}

/**
 * One issue per offending commit or, past auditIssueCap of them, one issue on
 * the tip that lists them all. An issue with the same title, open or closed,
 * is never opened twice: it gets a comment on the new occurrence, unless this
 * run already recorded it. The search is a phrase search; only an exact title
 * counts. Appends one report line per issue to `lines` as it goes, so a
 * failure halfway still shows what was recorded.
 */
function file(input, offenders, range, lines) {
  const entries = [...offenders]
  const groups =
    entries.length > auditIssueCap
      ? [{ sha: range.after, listed: entries }]
      : entries.map(([sha, reasons]) => ({ sha, listed: [[sha, reasons]] }))
  if (entries.length > auditIssueCap)
    lines.push(
      `- Mais de ${auditIssueCap} commits fora do loop: uma issue só, no topo ${short(range.after)}, lista os ${entries.length}.`,
    )
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-main-'))
  try {
    for (const { sha, listed } of groups) {
      const title = auditTitleFor(sha)
      const found = ghJson(`as issues com o título "${title}"`, [
        'issue',
        'list',
        '--repo',
        input.repo,
        '--state',
        'all',
        '--search',
        `"${title}" in:title`,
        '--json',
        'number,title,body,comments',
        '--limit',
        '100',
      ])
      if (!Array.isArray(found))
        throw new AuditError(`a busca por "${title}" não veio numa lista`)
      const same = found.find((issue) => issue?.title === title)
      const bodyFile = path.join(dir, `${sha}.md`)
      if (same !== undefined) {
        if (!Number.isInteger(same.number) || same.number < 1)
          throw new AuditError(`a issue "${title}" veio sem número`)
        if (mentionsRun(same, input.runId)) {
          lines.push(
            `- ${short(sha)}: já registrada na #${same.number} por esta execução`,
          )
          continue
        }
        writeFileSync(bodyFile, occurrenceBody(input, sha, listed, range))
        const out = gh(`comentar a nova ocorrência na #${same.number}`, [
          'issue',
          'comment',
          String(same.number),
          '--repo',
          input.repo,
          '--body-file',
          bodyFile,
        ])
        lines.push(
          `- ${short(sha)}: já registrada na #${same.number}; nova ocorrência comentada em ${firstLine(out) || `#${same.number}`}`,
        )
        continue
      }
      writeFileSync(bodyFile, issueBody(input, sha, listed, range))
      const out = gh(`abrir a issue "${title}"`, [
        'issue',
        'create',
        '--repo',
        input.repo,
        '--title',
        title,
        ...auditLabels.flatMap((label) => ['--label', label]),
        '--body-file',
        bodyFile,
      ])
      lines.push(
        `- ${short(sha)}: registrada em ${firstLine(out) || 'uma issue nova'}`,
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// The run

function report(lines) {
  const text = `${lines.join('\n')}\n`
  process.stdout.write(text)
  // The run's summary page shows the verdict without opening the log.
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    try {
      appendFileSync(summary, `### Auditoria de main\n\n${text}\n`)
    } catch {
      // The log above already carries it.
    }
  }
}

function header(input) {
  const at = `Auditoria de main em ${input.repo}`
  if (input.push)
    return `${at}: push ${short(input.before)}..${short(input.after)}${input.forced ? ' (force-push)' : ''}`
  return input.event === 'schedule'
    ? `${at}: execução agendada`
    : `${at}: execução manual`
}

/** How the interrupted run is re-run: this very run, which keeps its id. */
function rerunHint({ repo, runId }) {
  return runId === null
    ? 'Rode a auditoria de novo'
    : `Re-rode esta execução (gh run rerun ${runId} --repo ${repo})`
}

/**
 * The step auditJudgeStep: judges, files, and leaves the count for the next
 * step. Exit 0 once that count is left, whatever it is; non-zero, and no
 * count, when it stopped before.
 */
function judge() {
  const read = readInput(process.env)
  if (read.errors) {
    process.stderr.write(`audit-main: ${read.errors.join('\n')}\n`)
    process.exitCode = 2
    return
  }
  const { input } = read
  // A count left by anything before this run is never this run's verdict.
  rmSync(input.verdictFile, { force: true })
  const lines = [
    header(input),
    'Regra: toda mudança em main vem de uma PR que fecha uma issue, mergeada com os checks exigidos verdes.',
    '',
  ]
  const done = (count) => {
    lines.push(
      '',
      `Julgamento concluído: ${count} mudança(s) fora do loop. O passo ${auditVerdictStep} dá a cor da execução.`,
    )
    report(lines)
    writeFileSync(input.verdictFile, `${count}\n`)
  }
  if (input.push && zeroSha.test(input.before)) {
    lines.push('Nada a auditar: o push criou main, não há topo anterior.')
    done(0)
    return
  }
  if (input.push && zeroSha.test(input.after)) {
    lines.push('O push apagou main: não há commit para auditar.')
    report(lines)
    process.exitCode = 1
    return
  }

  let judged
  try {
    judged = audit(input)
  } catch (error) {
    if (!(error instanceof AuditError)) throw error
    lines.push(
      `Auditoria interrompida: ${error.message}.`,
      `Nenhuma issue foi aberta. ${rerunHint(input)}: ela não duplica issue.`,
    )
    report(lines)
    process.exitCode = 1
    return
  }
  const { range, audited, notes, offenders } = judged
  lines.push(
    range.lower === null
      ? `Intervalo auditado: a história até ${short(range.after)}, pelo primeiro pai.`
      : `Intervalo auditado: ${short(range.lower)}..${short(range.after)}, ${range.from}.`,
    '',
    `Commits auditados (${audited.length}):`,
    ...(audited.length > 0 ? audited : ['- nenhum']),
  )
  if (notes.length > 0)
    lines.push('', 'Observações:', ...notes.map((note) => `- ${note}`))

  if (offenders.size === 0) {
    lines.push(
      '',
      'Resultado: tudo o que chegou em main veio de uma PR que fecha uma issue, mergeada com os checks exigidos verdes.',
    )
    done(0)
    return
  }

  lines.push(
    '',
    `Fora do loop (${offenders.size}):`,
    ...[...offenders].map(
      ([sha, reasons]) => `- ${short(sha)}: ${reasons.join('; ')}`,
    ),
  )
  lines.push('', 'Issues:')
  try {
    file(input, offenders, range, lines)
  } catch (error) {
    if (!(error instanceof AuditError)) throw error
    lines.push(
      '',
      `Registro interrompido: ${error.message}.`,
      `${rerunHint(input)}: ela não duplica as issues já abertas.`,
    )
    report(lines)
    process.exitCode = 1
    return
  }
  lines.push(
    '',
    `Resultado: ${offenders.size} mudança(s) em main fora do loop. Em cada issue, o dono decide registrar retroativamente ou reverter.`,
  )
  done(offenders.size)
}

/**
 * The step auditVerdictStep: red when Julgar counted a change out of the loop,
 * and red when it left no count to read.
 */
function verdict() {
  const temp = String(process.env.RUNNER_TEMP ?? '')
  if (!path.isAbsolute(temp)) {
    process.stderr.write(
      `audit-main: RUNNER_TEMP deve ser o diretório temporário do runner, recebeu "${temp}"\n`,
    )
    process.exitCode = 2
    return
  }
  const file = path.join(temp, auditVerdictFile)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    process.stdout.write(
      `Veredito: o passo ${auditJudgeStep} não deixou a contagem em ${file}, então a auditoria não chegou ao fim. Re-rode esta execução.\n`,
    )
    process.exitCode = 1
    return
  }
  const count = /^(\d+)\n?$/.exec(text)
  if (count === null) {
    process.stdout.write(
      `Veredito: ${file} não traz uma contagem ("${firstLine(text)}"). Re-rode esta execução.\n`,
    )
    process.exitCode = 1
    return
  }
  if (Number(count[1]) === 0) {
    process.stdout.write('Veredito: nada chegou em main fora do loop.\n')
    return
  }
  process.stdout.write(
    `Veredito: ${Number(count[1])} mudança(s) em main fora do loop, registradas em issue pelo passo ${auditJudgeStep}. A execução fica vermelha.\n`,
  )
  process.exitCode = 1
}

const modes = { '--judge': judge, '--verdict': verdict }
const args = process.argv.slice(2)
if (args.length !== 1 || !Object.hasOwn(modes, args[0])) {
  process.stderr.write(
    `audit-main: uso: node scripts/audit-main.mjs --judge | --verdict (recebeu ${JSON.stringify(args)})\n`,
  )
  process.exitCode = 2
} else modes[args[0]]()
