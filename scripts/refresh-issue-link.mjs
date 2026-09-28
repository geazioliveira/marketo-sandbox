#!/usr/bin/env node
// Re-runs the issue-link check of the open pull requests an event is about:
// every open PR that closes an issue, when something on that issue changes
// (#3), or one PR, after a review on it or on demand (#13).
//
// Why: issue-link.yml runs on pull_request_target, and only events on the PR
// trigger it. A withdrawn Approve, a moved label, a new `# Plano`, a closing
// or a reopening happen on the issue, and each used to leave a green check
// with a stale verdict. A review is no pull_request_target event either, and
// since #13 the gate judges the Copilot review on the head and the open
// review threads. .github/workflows/issue-link-refresh.yml runs this from
// main; the gate, re-run, reads the issue and the PR again.
//
// Two modes, by GITHUB_EVENT_NAME:
// - issues and issue_comment (issue mode): the open PRs that close
//   ISSUE_NUMBER, as GitHub links them; nothing when IS_PR says the event's
//   issue is a pull request;
// - workflow_run, of review-signal.yml, and workflow_dispatch (PR mode):
//   PR_NUMBER, re-read here, and skipped when it is no longer open (Copilot
//   reviews merged PRs late, as it did #10 and #11). A workflow_run whose
//   pull_requests GitHub left empty hands HEAD_BRANCH instead, and the open
//   PRs of that branch in this repository are refreshed; a fork's branch of
//   the same name is not one of them.
//
// It judges nothing itself and writes nothing but the re-run (actions: write).
//
// Only a run of issueLinkEvent (pull_request_target) is re-run: that is the
// one that takes issue-link.yml from main. A pull_request run of the same file
// (a PR that gave it that trigger) judges the PR with the PR's own copy.
//
// A run still in progress may have read the issue before the change, and a run
// cannot be re-run until it finishes. Cancelling it first would need only the
// actions: write this job already has, but cancel-then-re-run races the run's
// own end and leaves a cancelled check on the PR in between. So it is waited
// for: polled every REFRESH_POLL_MS (refreshPollMs) until it completes, then
// re-run. Back-to-back events on one issue hit this every time, since the
// previous refresh has just re-run that very run. Past REFRESH_WAIT_MS
// (refreshWaitMs, inside the job's five minutes) the refresh goes red and says
// which run to re-run by hand.
//
// What it cannot do, and says so in its output:
// - GitHub re-runs a run at most 50 times, and only up to 30 days after it
//   started; past that the re-run is refused and this goes red, and a push to
//   the PR brings a fresh run;
// - whether GITHUB_TOKEN may re-run a pull_request_target run is unmeasured
//   until the first live event. The fresh verdict before merge stays the rule
//   (docs/development/workflow.md#pull-requests-e-merge).
//
// Input comes only from the environment: GITHUB_REPOSITORY and
// GITHUB_EVENT_NAME, which the runner sets; ISSUE_NUMBER and IS_PR ('true'
// when the event's issue is a pull request) in issue mode; PR_NUMBER and
// HEAD_BRANCH in PR mode; GH_TOKEN, which gh reads; REFRESH_POLL_MS and
// REFRESH_WAIT_MS, for the tests.
import { spawnSync } from 'node:child_process'
import {
  issueLinkEvent,
  issueLinkWorkflowFile,
  refreshPollMs,
  refreshPrCommand,
  refreshWaitMs,
} from './loop-sections.mjs'

const hexSha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const repoPattern = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/
const timeoutMs = 30_000
const maxBuffer = 64 * 1024 * 1024
const pageSize = 10
/** Sub-issues read per issue: a stack (#31) has a handful of slices. */
const subIssuePageSize = 50
const issueEvents = ['issues', 'issue_comment']
const prEvents = ['workflow_run', 'workflow_dispatch']
const positive = /^[1-9]\d*$/
/** A branch name, as git allows one: 1 to 255 characters, no space, no control character. */
const isBranchName = (text) =>
  text.length > 0 &&
  text.length <= 255 &&
  ![...text].some((char) => char <= ' ' || char === '\u007f')

// includeClosedPrs: false still lists merged PRs (measured on #2, closed by
// the merged PR #10), so only state OPEN is acted on below. The sub-issues
// come with their own closing PRs: a slice of a stack (#31) is judged by its
// parent, so an event on the parent changes their verdict too.
const issueQuery = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { closedByPullRequestsReferences(first: ${pageSize}, includeClosedPrs: false) { totalCount nodes { number state headRefOid } } subIssues(first: ${subIssuePageSize}) { totalCount nodes { number repository { nameWithOwner } closedByPullRequestsReferences(first: ${pageSize}, includeClosedPrs: false) { totalCount nodes { number state headRefOid } } } } } } }`

// PR mode: the PR as it is now, whatever the event carried.
const pullQuery = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { number state headRefOid } } }`

// PR mode with no PR number: the open PRs of a head branch. headRefName is
// only the name, so a fork's branch of the same name comes too, and its
// headRepository tells it apart.
const branchQuery = `query($owner: String!, $name: String!, $branch: String!) { repository(owner: $owner, name: $name) { pullRequests(first: ${pageSize}, headRefName: $branch, states: [OPEN]) { totalCount nodes { number state headRefOid headRepository { nameWithOwner } } } } }`

/** A failure that ends the refresh red, with a reason a person can act on. */
class RefreshError extends Error {}

const short = (sha) => String(sha ?? '').slice(0, 7)

/** Milliseconds as seconds, in pt-BR: 2500 is "2,5". */
const seconds = (ms) => (ms / 1000).toLocaleString('pt-BR')

const firstLine = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? ''

/** Blocks for `ms` milliseconds: the script is synchronous from end to end. */
function sleep(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** stdout of one gh call, through argv, or a RefreshError with gh's reason. */
function gh(what, args) {
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
    throw new RefreshError('gh não está instalado ou não está no PATH')
  if (run.error)
    throw new RefreshError(
      run.error.code === 'ETIMEDOUT'
        ? `gh não respondeu em ${timeoutMs / 1000} s (${what})`
        : `gh falhou (${what}): ${run.error.message}`,
    )
  if (run.status !== 0)
    throw new RefreshError(
      `gh falhou (${what}): ${firstLine(run.stderr) || `saiu com status ${run.status}`}`,
    )
  return run.stdout
}

function ghJson(what, args) {
  const out = gh(what, args)
  try {
    return JSON.parse(out)
  } catch {
    throw new RefreshError(`gh não devolveu JSON (${what})`)
  }
}

/** @returns {{ input: object } | { errors: string[] }} */
function readInput(env) {
  const errors = []
  const repo = String(env.GITHUB_REPOSITORY ?? '')
  const named = repoPattern.exec(repo)
  if (named === null)
    errors.push(`GITHUB_REPOSITORY deve ser dono/nome, recebeu "${repo}"`)
  const event = String(env.GITHUB_EVENT_NAME ?? '')
  const issueMode = issueEvents.includes(event)
  if (!issueMode && !prEvents.includes(event))
    errors.push(
      `GITHUB_EVENT_NAME deve ser ${[...issueEvents, ...prEvents].join(', ')}, recebeu "${event}"`,
    )
  const issue = String(env.ISSUE_NUMBER ?? '')
  const isPr = String(env.IS_PR ?? '')
  const pr = String(env.PR_NUMBER ?? '')
  const branch = String(env.HEAD_BRANCH ?? '')
  const headRepo = String(env.HEAD_REPO ?? '')
  if (issueMode) {
    if (!positive.test(issue))
      errors.push(`ISSUE_NUMBER deve ser o número da issue, recebeu "${issue}"`)
    if (isPr !== 'true' && isPr !== 'false')
      errors.push(`IS_PR deve ser true ou false, recebeu "${isPr}"`)
  } else if (event === 'workflow_dispatch' || pr !== '') {
    if (!positive.test(pr))
      errors.push(`PR_NUMBER deve ser o número da PR, recebeu "${pr}"`)
  } else if (event === 'workflow_run' && !isBranchName(branch))
    // GitHub left the run's pull_requests empty (it does for a fork's PR,
    // and the research could not rule out other cases): the branch is all
    // there is to find the PR by.
    errors.push(
      `sem PR_NUMBER, HEAD_BRANCH deve ser a branch da PR, recebeu "${branch}"`,
    )
  const pollMs = env.REFRESH_POLL_MS || String(refreshPollMs)
  const waitMs = env.REFRESH_WAIT_MS || String(refreshWaitMs)
  for (const [key, value] of [
    ['REFRESH_POLL_MS', pollMs],
    ['REFRESH_WAIT_MS', waitMs],
  ])
    if (!/^\d+$/.test(value))
      errors.push(
        `${key} deve ser um número de milissegundos, recebeu "${value}"`,
      )
  if (errors.length > 0) return { errors }
  return {
    input: {
      repo,
      owner: named[1],
      name: named[2],
      event,
      mode: issueMode ? 'issue' : 'pr',
      issue: issueMode ? Number(issue) : null,
      isPr: issueMode && isPr === 'true',
      pr: !issueMode && pr !== '' ? Number(pr) : null,
      branch: !issueMode && pr === '' ? branch : null,
      headRepo: !issueMode && pr === '' ? headRepo : null,
      pollMs: Number(pollMs),
      waitMs: Number(waitMs),
    },
  }
}

/**
 * The PRs that would close the issue, as GitHub links them, and those of each
 * of its sub-issues (#31). An answer with no subIssues (no sub-issue support)
 * reads as an issue with none.
 */
function closingPulls({ owner, name, issue, repo }) {
  const payload = ghJson(`as PRs que fecham a #${issue}`, [
    'api',
    'graphql',
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${issue}`,
    '-f',
    `query=${issueQuery}`,
  ])
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  const found = payload?.data?.repository?.issue
  const refs = found?.closedByPullRequestsReferences
  if (errors.length > 0 || refs == null)
    throw new RefreshError(
      `a consulta da #${issue} falhou: ${firstLine(errors[0]?.message) || 'sem dados'}`,
    )
  const nodes = Array.isArray(refs.nodes) ? refs.nodes : []
  const subs = found?.subIssues
  // A sub-issue in another repository is no slice of a stack here, and its
  // PRs run no issue-link of this repository: it is left out.
  const here = String(repo ?? `${owner}/${name}`).toLowerCase()
  const nodesOfSubs = Array.isArray(subs?.nodes) ? subs.nodes : []
  const children = nodesOfSubs
    .filter(
      (child) =>
        String(child?.repository?.nameWithOwner ?? '').toLowerCase() === here,
    )
    .map((child) => {
      const childRefs = child?.closedByPullRequestsReferences
      const childNodes = Array.isArray(childRefs?.nodes) ? childRefs.nodes : []
      return {
        number: child?.number,
        nodes: childNodes,
        total: Number(childRefs?.totalCount ?? childNodes.length),
      }
    })
  return {
    nodes,
    total: Number(refs.totalCount ?? nodes.length),
    children,
    // The page is judged against the sub-issues read, those of any repository.
    childrenRead: nodesOfSubs.length,
    childrenTotal: Number(subs?.totalCount ?? nodesOfSubs.length),
  }
}

/** The payload of one GraphQL read, or a RefreshError with GitHub's reason. */
function graphqlData(what, payload, pick) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  const data = pick(payload?.data?.repository)
  if (errors.length > 0 || data == null)
    throw new RefreshError(
      `a consulta ${what} falhou: ${firstLine(errors[0]?.message) || 'sem dados'}`,
    )
  return data
}

/** One PR as it is now: its number, state and head. */
function readPull({ owner, name }, number) {
  const what = `da PR #${number}`
  const payload = ghJson(`a PR #${number}`, [
    'api',
    'graphql',
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${number}`,
    '-f',
    `query=${pullQuery}`,
  ])
  return graphqlData(what, payload, (repository) => repository?.pullRequest)
}

/**
 * The open PRs of a head branch in this repository. The branch goes as a raw
 * string (-f): -F would read a value that starts with @ as a file.
 */
function branchPulls({ owner, name, repo }, branch) {
  const what = `das PRs da branch ${branch}`
  const payload = ghJson(`as PRs da branch ${branch}`, [
    'api',
    'graphql',
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-f',
    `branch=${branch}`,
    '-f',
    `query=${branchQuery}`,
  ])
  const pulls = graphqlData(
    what,
    payload,
    (repository) => repository?.pullRequests,
  )
  const nodes = (Array.isArray(pulls.nodes) ? pulls.nodes : []).filter(
    (pr) => pr != null,
  )
  const own = nodes.filter(
    (pr) =>
      String(pr.headRepository?.nameWithOwner ?? '').toLowerCase() ===
      repo.toLowerCase(),
  )
  return {
    nodes: own,
    others: nodes.length - own.length,
    total: Number(pulls.totalCount ?? nodes.length),
    read: nodes.length,
  }
}

/** One run, as GET actions/runs/{id} gives it now. */
function readRun({ repo }, id, pr) {
  const run = ghJson(`a run ${id} do issue-link da PR #${pr.number}`, [
    'api',
    `repos/${repo}/actions/runs/${id}`,
  ])
  if (run?.id !== id || typeof run.status !== 'string')
    throw new RefreshError(
      `a run ${id} do issue-link da PR #${pr.number} veio sem id ou sem status`,
    )
  return run
}

/**
 * Re-runs the latest issue-link run of one open PR, once it has finished: a
 * run still going is polled until it does, up to `deadline`.
 * @returns {{ lines: string[], failed: boolean }}
 */
function refresh(input, pr, deadline) {
  const { repo } = input
  const sha = String(pr.headRefOid ?? '')
  if (!hexSha.test(sha))
    throw new RefreshError(`a PR #${pr.number} veio sem o SHA da head`)
  const at = `- PR #${pr.number} (${short(sha)})`
  const listing = ghJson(`as runs do issue-link da PR #${pr.number}`, [
    'api',
    `repos/${repo}/actions/workflows/${issueLinkWorkflowFile}/runs?head_sha=${sha}&event=${issueLinkEvent}&per_page=1`,
  ])
  if (!Array.isArray(listing?.workflow_runs))
    throw new RefreshError(
      `as runs do issue-link da PR #${pr.number} não vieram numa lista`,
    )
  let run = listing.workflow_runs[0]
  if (run === undefined)
    return {
      lines: [
        `${at}: nenhuma run do issue-link (${issueLinkEvent}) para este commit. Faça push na PR ou rode o gate em modo CI.`,
      ],
      failed: false,
    }
  const { id } = run
  if (!Number.isInteger(id) || id < 1)
    throw new RefreshError(
      `a run do issue-link da PR #${pr.number} veio sem id`,
    )
  // A run still going may have read the issue before the change, and it
  // cannot be re-run until it finishes: wait for it.
  const lines = []
  if (run.status !== 'completed')
    lines.push(
      `${at}: a run ${id} do issue-link está ${run.status}; esperando ela terminar, até ${seconds(input.waitMs)} s ao todo, com uma consulta a cada ${seconds(input.pollMs)} s.`,
    )
  let waited = false
  while (run.status !== 'completed') {
    const left = deadline - Date.now()
    if (left <= 0) {
      lines.push(
        `${at}: a run ${id} do issue-link ainda não terminou (${run.status}) depois de ${seconds(input.waitMs)} s de espera; ela pode ter lido a issue antes da mudança. Re-rode quando terminar: gh run rerun ${id} --repo ${repo}`,
      )
      return { lines, failed: true }
    }
    sleep(Math.min(input.pollMs, left))
    run = readRun(input, id, pr)
    waited = true
  }
  gh(`re-rodar a run ${id} da PR #${pr.number}`, [
    'api',
    '-X',
    'POST',
    `repos/${repo}/actions/runs/${id}/rerun`,
  ])
  lines.push(
    `${at}: run ${id} do issue-link re-executada (era ${run.conclusion ?? 'sem conclusão'}${waited ? ', depois de esperar ela terminar' : ''}).`,
  )
  return { lines, failed: false }
}

/**
 * The note that ends an interrupted refresh: how to renew the verdict by
 * hand. Dispatching the refresh again only retries it: the command returns
 * before the refresh runs, so alone it is no fresh verdict.
 */
function interrupted(input, error) {
  const lines = [
    `Atualização interrompida: ${error.message}.`,
    'Antes do merge, renove o veredito à mão (gh run rerun <id> e gh run watch <id> --exit-status, ou o gate em modo CI na cabeça da PR) ou faça push na PR.',
  ]
  if (input.pr !== null)
    lines.push(
      `Para só tentar o refresh de novo: ${refreshPrCommand(input.pr)}; sozinho, isso não é veredito fresco.`,
    )
  return lines
}

/** Issue mode: every open PR that closes the issue. */
function refreshIssue(input, deadline, lines) {
  lines.push(`Atualiza o issue-link das PRs que fecham a #${input.issue}.`)
  if (input.isPr) {
    lines.push(
      `A #${input.issue} é uma PR, não uma issue: os eventos dela já rodam o issue-link. Nada a fazer.`,
    )
    return 0
  }
  const { nodes, total, children, childrenRead, childrenTotal } =
    closingPulls(input)
  if (children.length > 0)
    lines.push(
      `A #${input.issue} tem ${children.length} sub-issue(s): o issue-link das PRs que as fecham também é re-rodado, porque uma fatia de stack é julgada pela mãe.`,
    )
  // One PR can close the issue and a sub-issue: it is refreshed once.
  const seen = new Set()
  const all = [...nodes, ...children.flatMap((child) => child.nodes)].filter(
    (pr) => {
      if (seen.has(pr?.number)) return false
      seen.add(pr?.number)
      return true
    },
  )
  const open = all.filter((pr) => pr?.state === 'OPEN')
  for (const pr of all.filter((node) => node?.state !== 'OPEN'))
    lines.push(`- PR #${pr?.number} ignorada: está ${pr?.state}.`)
  if (open.length === 0)
    lines.push(
      children.length > 0
        ? `Nenhuma PR aberta fecha a #${input.issue} nem as sub-issues dela: nada a re-rodar.`
        : `Nenhuma PR aberta fecha a #${input.issue}: nada a re-rodar.`,
    )
  let exitCode = 0
  for (const pr of open) {
    const refreshed = refresh(input, pr, deadline)
    lines.push(...refreshed.lines)
    if (refreshed.failed) exitCode = 1
  }
  if (total > nodes.length) {
    // Only the first page was read: a PR past it keeps its old verdict.
    lines.push(
      `A #${input.issue} é fechada por ${total} PRs e só ${nodes.length} foram lidas; re-rode o issue-link das outras à mão.`,
    )
    exitCode = 1
  }
  if (childrenTotal > childrenRead) {
    lines.push(
      `A #${input.issue} tem ${childrenTotal} sub-issues e só ${childrenRead} foram lidas; re-rode à mão o issue-link das PRs das outras.`,
    )
    exitCode = 1
  }
  for (const child of children)
    if (child.total > child.nodes.length) {
      lines.push(
        `A #${child.number}, sub-issue da #${input.issue}, é fechada por ${child.total} PRs e só ${child.nodes.length} foram lidas; re-rode o issue-link das outras à mão.`,
      )
      exitCode = 1
    }
  return exitCode
}

/**
 * PR mode: one PR, re-read now, or the open PRs of a branch. A PR that is no
 * longer open has no verdict left to renew.
 */
function refreshPull(input, deadline, lines) {
  const why =
    input.event === 'workflow_run'
      ? 'depois de uma revisão (Sinal de revisão)'
      : 'a pedido (workflow_dispatch)'
  let pulls
  let exitCode = 0
  if (input.pr !== null) {
    lines.push(`Atualiza o issue-link da PR #${input.pr}, ${why}.`)
    pulls = [readPull(input, input.pr)]
  } else {
    lines.push(
      `Atualiza o issue-link das PRs abertas da branch ${input.branch}, ${why}: a run do sinal não nomeou a PR.`,
    )
    // GitHub leaves pull_requests empty for a fork's PR. Its branch name says
    // nothing about this repository's PRs, so a same-named branch here is no
    // evidence: look the branch up only when it came from this repository.
    if (
      String(input.headRepo ?? '').toLowerCase() !== input.repo.toLowerCase()
    ) {
      lines.push(
        input.headRepo
          ? `A revisão veio de uma branch de ${input.headRepo}, não deste repositório: o issue-link não vale para fork, e uma branch ${input.branch} daqui não é a origem. Nada a re-rodar.`
          : `O evento não disse de que repositório veio a branch ${input.branch}: sem essa prova, nenhuma PR daqui é re-rodada.`,
      )
      return exitCode
    }
    const { nodes, others, total, read } = branchPulls(input, input.branch)
    if (others > 0)
      lines.push(
        `- ${others} PR(s) de fork com a branch ${input.branch} ignorada(s): o issue-link só vale para branches deste repositório.`,
      )
    if (nodes.length === 0)
      lines.push(
        `Nenhuma PR aberta da branch ${input.branch} neste repositório: nada a re-rodar.`,
      )
    if (total > read) {
      lines.push(
        `A branch ${input.branch} tem ${total} PRs abertas e só ${read} foram lidas; re-rode o issue-link das outras à mão.`,
      )
      exitCode = 1
    }
    pulls = nodes
  }
  for (const pr of pulls) {
    if (pr.state !== 'OPEN') {
      lines.push(
        `- PR #${pr.number} ignorada: está ${pr.state}, e o issue-link dela não decide mais nada. Nada a re-rodar.`,
      )
      continue
    }
    const refreshed = refresh(input, pr, deadline)
    lines.push(...refreshed.lines)
    if (refreshed.failed) exitCode = 1
  }
  return exitCode
}

function main() {
  const read = readInput(process.env)
  if (read.errors) {
    process.stderr.write(`refresh-issue-link: ${read.errors.join('\n')}\n`)
    process.exitCode = 2
    return
  }
  const { input } = read
  // One deadline for every PR, so the waits together stay inside the job.
  const deadline = Date.now() + input.waitMs
  const lines = []
  try {
    process.exitCode =
      input.mode === 'issue'
        ? refreshIssue(input, deadline, lines)
        : refreshPull(input, deadline, lines)
  } catch (error) {
    if (!(error instanceof RefreshError)) throw error
    lines.push(...interrupted(input, error))
    process.exitCode = 1
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

main()
