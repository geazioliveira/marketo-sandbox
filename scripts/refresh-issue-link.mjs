#!/usr/bin/env node
// Re-runs the issue-link check of every open pull request that closes an
// issue, when something on that issue changes (#3).
//
// Why: issue-link.yml runs on pull_request_target, and only events on the PR
// trigger it. A withdrawn Approve, a moved label, a new `# Plano`, a closing
// or a reopening happen on the issue, and each used to leave a green check
// with a stale verdict. .github/workflows/issue-link-refresh.yml runs this on
// those issue events; the gate, re-run, reads the issue again.
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
// Input comes only from the environment: GITHUB_REPOSITORY, ISSUE_NUMBER,
// IS_PR ('true' when the event's issue is a pull request) and GH_TOKEN, which
// gh reads; REFRESH_POLL_MS and REFRESH_WAIT_MS, for the tests.
import { spawnSync } from 'node:child_process'
import {
  issueLinkEvent,
  issueLinkWorkflowFile,
  refreshPollMs,
  refreshWaitMs,
} from './loop-sections.mjs'

const hexSha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const repoPattern = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/
const timeoutMs = 30_000
const maxBuffer = 64 * 1024 * 1024
const pageSize = 10

// includeClosedPrs: false still lists merged PRs (measured on #2, closed by
// the merged PR #10), so only state OPEN is acted on below.
const issueQuery = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { closedByPullRequestsReferences(first: ${pageSize}, includeClosedPrs: false) { totalCount nodes { number state headRefOid } } } } }`

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
  const issue = String(env.ISSUE_NUMBER ?? '')
  if (!/^[1-9]\d*$/.test(issue))
    errors.push(`ISSUE_NUMBER deve ser o número da issue, recebeu "${issue}"`)
  const isPr = String(env.IS_PR ?? '')
  if (isPr !== 'true' && isPr !== 'false')
    errors.push(`IS_PR deve ser true ou false, recebeu "${isPr}"`)
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
      issue: Number(issue),
      isPr: isPr === 'true',
      pollMs: Number(pollMs),
      waitMs: Number(waitMs),
    },
  }
}

/** The PRs that would close the issue, as GitHub links them. */
function closingPulls({ owner, name, issue }) {
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
  const refs = payload?.data?.repository?.issue?.closedByPullRequestsReferences
  if (errors.length > 0 || refs == null)
    throw new RefreshError(
      `a consulta da #${issue} falhou: ${firstLine(errors[0]?.message) || 'sem dados'}`,
    )
  const nodes = Array.isArray(refs.nodes) ? refs.nodes : []
  return { nodes, total: Number(refs.totalCount ?? nodes.length) }
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
  const lines = [`Atualiza o issue-link das PRs que fecham a #${input.issue}.`]
  if (input.isPr) {
    lines.push(
      `A #${input.issue} é uma PR, não uma issue: os eventos dela já rodam o issue-link. Nada a fazer.`,
    )
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }

  try {
    const { nodes, total } = closingPulls(input)
    const open = nodes.filter((pr) => pr?.state === 'OPEN')
    for (const pr of nodes.filter((node) => node?.state !== 'OPEN'))
      lines.push(`- PR #${pr?.number} ignorada: está ${pr?.state}.`)
    if (open.length === 0)
      lines.push(`Nenhuma PR aberta fecha a #${input.issue}: nada a re-rodar.`)
    for (const pr of open) {
      const refreshed = refresh(input, pr, deadline)
      lines.push(...refreshed.lines)
      if (refreshed.failed) process.exitCode = 1
    }
    if (total > nodes.length) {
      // Only the first page was read: a PR past it keeps its old verdict.
      lines.push(
        `A #${input.issue} é fechada por ${total} PRs e só ${nodes.length} foram lidas; re-rode o issue-link das outras à mão.`,
      )
      process.exitCode = 1
    }
  } catch (error) {
    if (!(error instanceof RefreshError)) throw error
    lines.push(
      `Atualização interrompida: ${error.message}.`,
      'Antes do merge, renove o veredito à mão (gh run rerun) ou faça push na PR.',
    )
    process.exitCode = 1
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

main()
