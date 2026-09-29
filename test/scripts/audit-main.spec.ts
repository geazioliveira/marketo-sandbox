import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base } from 'vitest'
import {
  agentCreateStateLabels,
  auditBaseline,
  auditChecksPage,
  auditClosingPage,
  auditCommitCap,
  auditCron,
  auditIssueCap,
  auditJudgeStep,
  auditLabels,
  auditLinkRetries,
  auditRetryDelayMs,
  auditReviewPage,
  auditRunsRead,
  auditTitleFor,
  auditVerdictFile,
  auditVerdictStep,
  categoryLabels,
  copilotReviewer,
  issueLinkEvent,
  issueLinkWorkflowPath,
  mainAuditWorkflowFile,
  requiredChecks,
  reviewRuleSince,
  skipCiTokens,
} from '../../scripts/loop-sections.mjs'
import { cleanEnv } from '../support/clean-env'
import { exec, projectRoot } from '../support/temp-repo'

/**
 * scripts/audit-main.mjs, driven as main-audit.yml drives it: a throwaway
 * repository holds main's history, a strict fake gh (fake-gh-api.mjs) stands
 * first on PATH, and the script runs as a child process with its input in the
 * environment, once as the step Julgar (--judge) and, when that succeeds,
 * once as the step Veredito (--verdict), sharing a RUNNER_TEMP. Nothing here
 * reads or writes the real tracker.
 *
 * Commits are built with commit-tree on the empty tree: the audit reads only
 * SHAs and their parents, and one process per commit keeps the cases fast.
 * Each case builds its own repository, removed when it finishes, so the cases
 * run concurrently.
 */

const REPO = 'geazioliveira/marketo-sandbox'
const ZERO = '0'.repeat(40)
/** This run's id, as the runner sets GITHUB_RUN_ID. */
const RUN_ID = 5000
const script = path.join(projectRoot, 'scripts', 'audit-main.mjs')
const fakeGh = path.join(projectRoot, 'test', 'support', 'fake-gh-api.mjs')

/** Fixed, so the SHAs depend only on each commit's message and parents. */
const identity = {
  GIT_AUTHOR_NAME: 'Audit Spec',
  GIT_AUTHOR_EMAIL: 'audit-spec@example.invalid',
  GIT_AUTHOR_DATE: '2026-09-25T00:00:00Z',
  GIT_COMMITTER_NAME: 'Audit Spec',
  GIT_COMMITTER_EMAIL: 'audit-spec@example.invalid',
  GIT_COMMITTER_DATE: '2026-09-25T00:00:00Z',
}

interface Call {
  argv: string[]
  at: number
  key?: string
  head?: string
  body?: string
  failed?: string
  violation?: string
}

type FailMode = 'auth' | 'unreachable' | 'forbidden' | 'notFound'

interface Fixture {
  answers?: Record<string, unknown>
  sequences?: Record<string, unknown[]>
  fail?: Record<string, FailMode>
}

type AuditEvent = 'push' | 'schedule' | 'workflow_dispatch'

/** How a step of a past run ended; null for a step that never started. */
type StepConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | null

/** A completed run of main-audit.yml on main: its listing entry and its Julgar. */
interface PastAudit {
  id: number
  head: string
  conclusion: string
  judge: StepConclusion
}

interface AuditOptions {
  /** push by default. */
  event?: AuditEvent
  before?: string
  after?: string
  forced?: 'true' | 'false'
  /** The audit's baseline; omitted, the script uses the contract's. */
  baseline?: string
  /** The completed runs of main-audit.yml on main GitHub lists; none by default. */
  audits?: PastAudit[]
  fixture?: Fixture
  /** Extra environment; undefined removes a variable. */
  env?: Record<string, string | undefined>
  /** Replaces PATH entirely. */
  pathOverride?: string
}

interface Step {
  status: number | null
  stdout: string
  stderr: string
}

interface AuditRun {
  /** The job's outcome: Julgar's exit when it failed, else Veredito's. */
  status: number | null
  /** Julgar's exit, and its output in stdout and stderr. */
  judge: number | null
  stdout: string
  stderr: string
  out: string
  /** What Julgar left for Veredito; null when it left nothing. */
  count: string | null
  /** Veredito, run only when Julgar succeeded, as the workflow runs it. */
  verdict: Step | null
  calls: Call[]
}

class History {
  readonly root: string
  readonly dir: string
  readonly bin: string
  readonly log: string
  readonly fixturePath: string
  /** RUNNER_TEMP, shared by the two steps as on the runner. */
  readonly temp: string
  readonly verdictFile: string
  private tree = ''

  private constructor() {
    this.root = mkdtempSync(path.join(tmpdir(), 'audit-main-spec-'))
    this.dir = path.join(this.root, 'repo')
    this.bin = path.join(this.root, 'bin')
    this.log = path.join(this.root, 'gh.log')
    this.fixturePath = path.join(this.root, 'fixture.json')
    this.temp = path.join(this.root, 'runner-temp')
    this.verdictFile = path.join(this.temp, auditVerdictFile)
    mkdirSync(this.dir, { recursive: true })
    mkdirSync(this.bin, { recursive: true })
    mkdirSync(this.temp, { recursive: true })
    const shim = path.join(this.bin, 'gh')
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeGh)} "$@"\n`,
    )
    chmodSync(shim, 0o755)
  }

  static async create(): Promise<History> {
    const history = new History()
    try {
      await history.git('init', '-q')
      history.tree = await history.git('write-tree')
    } catch (error) {
      history.remove()
      throw error
    }
    return history
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true })
  }

  env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return cleanEnv(this.root, {
      bin: this.bin,
      extra: { ...identity, ...extra },
    })
  }

  async git(...args: string[]): Promise<string> {
    const run = await exec('git', args, {
      cwd: this.dir,
      env: this.env(),
      timeout: 60_000,
    })
    if (run.status !== 0)
      throw new Error(`git ${args.join(' ')} falhou: ${run.stderr}`)
    return run.stdout.trim()
  }

  /** A commit on the empty tree with these parents, first parent first. */
  commit(message: string, ...parents: string[]): Promise<string> {
    return this.git(
      'commit-tree',
      this.tree,
      ...parents.flatMap((parent) => ['-p', parent]),
      '-m',
      message,
    )
  }

  /** A merge commit, as GitHub makes it: main first, the PR's branch second. */
  async merge(onto: string, pr: number): Promise<string> {
    const branch = await this.commit(`Trabalho da PR #${pr}`, onto)
    return this.commit(
      `Merge pull request #${pr} from geazioliveira/feature/${pr}-x`,
      onto,
      branch,
    )
  }

  /** `count` commits in a line on top of `from`, in one process; the tip. */
  async burst(from: string, count: number): Promise<string> {
    const commands: string[] = []
    for (let i = 1; i <= count; i += 1) {
      const message = `Commit direto ${i}\n`
      commands.push(
        'commit refs/heads/burst',
        'committer Audit Spec <audit-spec@example.invalid> 1790000000 +0000',
        `data ${Buffer.byteLength(message)}`,
        message,
      )
      if (i === 1) commands.push(`from ${from}`, '')
    }
    const stream = path.join(this.root, 'burst.fi')
    writeFileSync(stream, `${commands.join('\n')}\n`)
    const run = await exec(
      'sh',
      ['-c', 'git fast-import --quiet < "$1"', 'sh', stream],
      { cwd: this.dir, env: this.env(), timeout: 60_000 },
    )
    if (run.status !== 0) throw new Error(`fast-import falhou: ${run.stderr}`)
    return this.git('rev-parse', 'refs/heads/burst')
  }

  /** The commits of `from..to`, oldest first. */
  async line(from: string, to: string): Promise<string[]> {
    return (await this.git('rev-list', '--reverse', `${from}..${to}`)).split(
      '\n',
    )
  }

  /** Main at `sha`, checked out: the HEAD a schedule or a dispatch audits. */
  async checkout(sha: string): Promise<void> {
    await this.git('update-ref', 'refs/heads/main', sha)
    await this.git('symbolic-ref', 'HEAD', 'refs/heads/main')
  }

  /** The step Veredito alone, as the workflow runs it after Julgar. */
  verdict(env: Record<string, string | undefined> = {}): Promise<Step> {
    const childEnv = this.env({ RUNNER_TEMP: this.temp })
    for (const [key, value] of Object.entries(env))
      if (value === undefined) delete childEnv[key]
      else childEnv[key] = value
    return exec(process.execPath, [script, '--verdict'], {
      cwd: this.dir,
      env: childEnv,
      timeout: 60_000,
    })
  }

  async audit(options: AuditOptions): Promise<AuditRun> {
    const event = options.event ?? 'push'
    const audits = options.audits ?? []
    writeFileSync(
      this.fixturePath,
      JSON.stringify({
        repo: REPO,
        ...options.fixture,
        answers: {
          audits: {
            total_count: audits.length,
            workflow_runs: audits.map(listed),
          },
          ...Object.fromEntries(
            audits.map((past) => [`jobs:${past.id}`, jobsOf(past)]),
          ),
          ...options.fixture?.answers,
        },
      }),
    )
    rmSync(this.log, { force: true })
    const env = this.env({
      FAKE_GH_LOG: this.log,
      FAKE_GH_FIXTURE: this.fixturePath,
      GH_TOKEN: 'fake-token',
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_NAME: event,
      GITHUB_RUN_ID: String(RUN_ID),
      AUDIT_RETRY_DELAY_MS: '0',
      RUNNER_TEMP: this.temp,
      // The workflow hands these over on every event, empty outside a push.
      BEFORE: options.before ?? '',
      AFTER: options.after ?? '',
      FORCED: event === 'push' ? (options.forced ?? 'false') : '',
      ...(options.baseline === undefined
        ? {}
        : { AUDIT_BASELINE: options.baseline }),
    })
    for (const [key, value] of Object.entries(options.env ?? {}))
      if (value === undefined) delete env[key]
      else env[key] = value
    if (options.pathOverride !== undefined) env.PATH = options.pathOverride
    const run = await exec(process.execPath, [script, '--judge'], {
      cwd: this.dir,
      env,
      timeout: 60_000,
    })
    const count = existsSync(this.verdictFile)
      ? readFileSync(this.verdictFile, 'utf8')
      : null
    // Veredito runs only when Julgar succeeded, as a step after a failed one.
    const verdict =
      run.status === 0
        ? await exec(process.execPath, [script, '--verdict'], {
            cwd: this.dir,
            env,
            timeout: 60_000,
          })
        : null
    const calls: Call[] = existsSync(this.log)
      ? readFileSync(this.log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Call)
      : []
    // A call the fake does not accept fails the case here, whatever the case
    // asserts: a refusal must never pass as a gh error.
    const refused = calls.filter((call) => call.violation !== undefined)
    if (refused.length > 0)
      throw new Error(
        `o gh falso recusou: ${refused.map((call) => call.violation).join('; ')}`,
      )
    return {
      status: verdict === null ? run.status : verdict.status,
      judge: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      out: `${run.stdout}${run.stderr}${verdict?.stdout ?? ''}${verdict?.stderr ?? ''}`,
      count,
      verdict,
      calls,
    }
  }
}

const test = base.extend<{ fresh: () => Promise<History> }>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  fresh: async ({}, use) => {
    const made: History[] = []
    await use(async () => {
      const history = await History.create()
      made.push(history)
      return history
    })
    for (const history of made) history.remove()
  },
})

vi.setConfig({ testTimeout: 120_000, maxConcurrency: 12 })

// ---------------------------------------------------------------------------
// What GitHub answers

/**
 * A completed run of main-audit.yml on main. By default it went green: Julgar
 * succeeded and counted nothing. `judge` is how its Julgar ended.
 */
const auditRun = (
  id: number,
  head: string,
  {
    conclusion = 'success',
    judge = 'success',
  }: { conclusion?: string; judge?: StepConclusion } = {},
): PastAudit => ({ id, head, conclusion, judge })

/** The run as the runs listing gives it. */
function listed({ id, head, conclusion }: PastAudit) {
  return {
    id,
    head_sha: head,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion,
  }
}

/** Its jobs, as GET actions/runs/{id}/jobs gives them: the one job, audit. */
function jobsOf({ id, conclusion, judge }: PastAudit) {
  const step = (name: string, stepConclusion: string, number: number) => ({
    name,
    status: 'completed',
    conclusion: stepConclusion,
    number,
  })
  const judged = judge === 'success'
  return {
    total_count: 1,
    jobs: [
      {
        id: id * 10,
        run_id: id,
        run_attempt: 1,
        name: 'audit',
        status: 'completed',
        conclusion,
        steps: [
          step('Set up job', 'success', 1),
          step('Run actions/checkout', 'success', 2),
          ...(judge === null ? [] : [step(auditJudgeStep, judge, 4)]),
          ...(judge === null
            ? []
            : [
                step(
                  auditVerdictStep,
                  judged
                    ? conclusion === 'success'
                      ? 'success'
                      : 'failure'
                    : 'skipped',
                  5,
                ),
              ]),
          step('Complete job', 'success', 6),
        ],
      },
    ],
  }
}

/** A PR's head commit, distinct for each PR number. */
const headOf = (number: number): string => String(number).padStart(40, 'a')

const MERGED_AT = '2026-09-25T01:00:00Z'

/** A PR as `GET repos/{r}/commits/{sha}/pulls` lists it. */
const pull = (
  number: number,
  mergeSha: string,
  overrides: Record<string, unknown> = {},
) => ({
  number,
  state: 'closed',
  merged_at: MERGED_AT,
  base: { ref: 'main' },
  head: { ref: `feature/${number}-x`, sha: headOf(number) },
  merge_commit_sha: mergeSha,
  ...overrides,
})

/** The PRs GitHub associates with a commit. */
const pullsOf = (sha: string, ...prs: unknown[]) => ({
  [`pulls:${sha}`]: prs,
})

/**
 * What the GraphQL query gives of a merge: when, at which head, and the
 * reviews and review threads (#13). By default merged at MERGED_AT, before
 * reviewRuleSince, with no review and no thread.
 */
const mergeFields = (
  number: number,
  {
    mergedAt = MERGED_AT,
    reviews = [],
    threads = [],
  }: {
    mergedAt?: string
    reviews?: unknown[]
    threads?: unknown[]
  } = {},
) => ({
  mergedAt,
  headRefOid: headOf(number),
  reviews: { totalCount: reviews.length, nodes: reviews },
  reviewThreads: { totalCount: threads.length, nodes: threads },
})

/** A PR as the GraphQL query sees it, closing `closes` in this repository. */
const prAnswer = (
  number: number,
  {
    closes = [5],
    body = 'Closes #5.\n\n## Risco\n\nNORMAL.',
    repo = REPO,
    ...merge
  }: {
    closes?: number[]
    body?: string
    repo?: string
  } & Parameters<typeof mergeFields>[1] = {},
) => ({
  [`pr:${number}`]: {
    ...mergeFields(number, merge),
    number,
    body,
    closingIssuesReferences: {
      totalCount: closes.length,
      nodes: closes.map((issue) => ({
        number: issue,
        repository: { nameWithOwner: repo },
      })),
    },
  },
})

/** Closing references to issues of another repository, numbered from 1. */
const foreignRefs = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    repository: { nameWithOwner: 'geazioliveira/lite-campaign' },
  }))

/** A reference to issue `number` of this repository. */
const ownRef = (number: number) => ({
  number,
  repository: { nameWithOwner: REPO },
})

interface Origin {
  /** The event of the suite's workflow run. */
  event?: string
  /** Its workflow file; null when GitHub names none. */
  file?: string | null
}

interface CheckRun extends Origin {
  workflow: string
  job: string
  conclusion: string | null
  startedAt?: string | null
  completedAt?: string | null
}

const ISSUE_LINK = { workflow: 'Vínculo com issue', job: 'issue-link' }
const QUALITY = { workflow: 'Qualidade', job: 'check' }

/**
 * Where each workflow runs from on a PR: issue-link.yml from main, on
 * pull_request_target; check.yml from the PR itself, on pull_request.
 */
const originOf = (workflow: string): Required<Origin> =>
  workflow === ISSUE_LINK.workflow
    ? { event: 'pull_request_target', file: '.github/workflows/issue-link.yml' }
    : { event: 'pull_request', file: '.github/workflows/check.yml' }

/** A check suite, as one workflow run leaves on a commit. */
const suite = (
  workflow: string,
  runs: Omit<CheckRun, 'workflow' | 'event' | 'file'>[],
  { event, file }: Origin = {},
) => ({
  workflowRun: {
    event: event ?? originOf(workflow).event,
    file: file === null ? null : { path: file ?? originOf(workflow).file },
    workflow: { name: workflow },
  },
  checkRuns: {
    totalCount: runs.length,
    nodes: runs.map(
      ({
        job,
        conclusion,
        startedAt = '2026-09-25T00:50:00Z',
        completedAt = '2026-09-25T00:55:00Z',
      }) => ({ name: job, conclusion, startedAt, completedAt }),
    ),
  },
})

/** The head commit's check suites, one per run. */
const checksOn = (head: string, runs: CheckRun[]) => ({
  [`checks:${head}`]: {
    checkSuites: {
      totalCount: runs.length,
      nodes: runs.map(({ workflow, event, file, ...run }) =>
        suite(workflow, [run], { event, file }),
      ),
    },
  },
})

/** Every required check green on the head, well before the merge. */
const greenOn = (head: string) =>
  checksOn(
    head,
    requiredChecks.map((check) => ({ ...check, conclusion: 'SUCCESS' })),
  )

/** The head's checks, as greenOn gives them. */
type HeadChecks = ReturnType<typeof greenOn>[string]

/** A merge commit of PR `number`, closing issue 5, its checks green. */
const mergedAndClosing = (sha: string, number: number) => ({
  ...pullsOf(sha, pull(number, sha)),
  ...prAnswer(number),
  ...greenOn(headOf(number)),
})

/** No issue yet with this commit's title, and the one the audit opens. */
const filed = (sha: string, number = 901) => ({
  [`search:${auditTitleFor(sha)}`]: [],
  [`create:${auditTitleFor(sha)}`]: number,
})

const keys = (calls: Call[]): (string | undefined)[] =>
  calls.map((call) => call.key)

// ---------------------------------------------------------------------------
// The review rule (#13)

/** A merge after reviewRuleSince, so the review rule holds for it. */
const RULED_AT = '2026-09-26T01:00:00Z'

/** An instant `seconds` away from `time`, as GitHub writes one. */
const shift = (time: string, seconds: number): string =>
  new Date(Date.parse(time) + seconds * 1000).toISOString().replace('.000', '')

/** Copilot as GraphQL gives a review's author: a Bot, with its database id. */
const COPILOT = {
  __typename: copilotReviewer.typename,
  databaseId: copilotReviewer.databaseId,
}

/** A review body as Copilot writes one when it reviewed. */
const REVIEWED =
  '## Pull request overview\n\nCopilot reviewed 2 out of 2 changed files in this pull request and generated 1 comment.'

/** A review as the audit's query reads it: by Copilot on the head, by default. */
const review = (
  number: number,
  {
    on = headOf(number),
    at = shift(RULED_AT, -60),
    state = 'COMMENTED',
    author = COPILOT as Record<string, unknown> | null,
    body = REVIEWED as string | null,
  } = {},
) => ({ state, submittedAt: at, commit: { oid: on }, author, body })

/** A review thread as the audit's query reads it: its state and its opening. */
const thread = ({
  resolved = false,
  openedAt = shift(RULED_AT, -120) as string | null,
} = {}) => ({
  isResolved: resolved,
  comments: { nodes: openedAt === null ? [] : [{ createdAt: openedAt }] },
})

/**
 * A merge commit of PR `number`, closing issue 5, its checks green, merged at
 * `mergedAt` (RULED_AT by default) with these reviews and threads.
 */
const reviewedMerge = (
  sha: string,
  number: number,
  {
    mergedAt = RULED_AT,
    reviews = [review(number)],
    threads = [] as unknown[],
  }: { mergedAt?: string; reviews?: unknown[]; threads?: unknown[] } = {},
) => ({
  ...pullsOf(sha, pull(number, sha, { merged_at: mergedAt })),
  ...prAnswer(number, { mergedAt, reviews, threads }),
  ...greenOn(headOf(number)),
})

const created = (calls: Call[]): Call[] =>
  calls.filter((call) => call.argv[0] === 'issue' && call.argv[1] === 'create')

const commented = (calls: Call[]): Call[] =>
  calls.filter((call) => call.argv[0] === 'issue' && call.argv[1] === 'comment')

const sha7 = (sha: string) => sha.slice(0, 7)

/** Two commits from before the loop; the second is the baseline. */
async function preLoop(
  history: History,
): Promise<{ first: string; baseline: string }> {
  const first = await history.commit('Pré-loop 1')
  const baseline = await history.commit('Pré-loop 2: a base', first)
  return { first, baseline }
}

describe.concurrent('scripts/audit-main.mjs', () => {
  // -------------------------------------------------------------------------
  // Nothing to audit, or nothing it can read

  describe.concurrent('input', () => {
    test('a push that creates main has nothing to audit and asks gh nothing', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const run = await history.audit({ before: ZERO, after: baseline })
      expect(run.status).toBe(0)
      expect(run.count).toBe('0\n')
      expect(run.calls).toEqual([])
      expect(run.stdout).toContain('Nada a auditar')
    })

    test('a push that deletes main goes red and asks gh nothing', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const run = await history.audit({ before: baseline, after: ZERO })
      expect(run.status).toBe(1)
      expect(run.judge).toBe(1)
      expect(run.count).toBeNull()
      expect(run.calls).toEqual([])
      expect(run.stdout).toContain('O push apagou main')
    })

    test.for<[string, Record<string, string | undefined>]>([
      ['BEFORE', { BEFORE: 'abc1234' }],
      ['AFTER', { AFTER: undefined }],
      ['FORCED', { FORCED: 'yes' }],
      ['GITHUB_REPOSITORY', { GITHUB_REPOSITORY: 'marketo-sandbox' }],
      ['GITHUB_EVENT_NAME', { GITHUB_EVENT_NAME: 'pull_request' }],
      ['GITHUB_EVENT_NAME', { GITHUB_EVENT_NAME: undefined }],
      ['GITHUB_RUN_ID', { GITHUB_RUN_ID: 'abc' }],
      ['AUDIT_BASELINE', { AUDIT_BASELINE: '8d4662f' }],
      ['AUDIT_RETRY_DELAY_MS', { AUDIT_RETRY_DELAY_MS: '-1' }],
      ['RUNNER_TEMP', { RUNNER_TEMP: undefined }],
      ['RUNNER_TEMP', { RUNNER_TEMP: 'runner-temp' }],
    ])(
      'refuses a malformed %s with exit 2',
      async ([name, env], { expect, fresh }) => {
        const history = await fresh()
        const { first, baseline } = await preLoop(history)
        const run = await history.audit({ before: first, after: baseline, env })
        expect(run.status).toBe(2)
        expect(run.stderr).toContain(name)
        expect(run.calls).toEqual([])
      },
    )

    test.for<string[]>([[], ['--both'], ['--judge', '--verdict']])(
      'refuses to run without exactly one of --judge and --verdict: %j',
      async (args, { expect, fresh }) => {
        const history = await fresh()
        const run = await exec(process.execPath, [script, ...args], {
          cwd: history.dir,
          env: history.env({ RUNNER_TEMP: history.temp }),
          timeout: 60_000,
        })
        expect(run.status).toBe(2)
        expect(run.stderr).toContain(
          'uso: node scripts/audit-main.mjs --judge | --verdict',
        )
      },
    )

    test('goes red when AFTER is not in the clone', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const run = await history.audit({
        before: baseline,
        after: 'a'.repeat(40),
        baseline,
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('não está no clone')
      expect(run.calls).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Julgar and Veredito

  describe.concurrent('the two steps', () => {
    test('Julgar succeeds with the count of changes out of the loop, and Veredito goes red on it', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: { answers: { ...pullsOf(direct), ...filed(direct) } },
      })
      expect(run.judge, run.out).toBe(0)
      expect(run.count).toBe('1\n')
      expect(run.stdout).toContain(
        `Julgamento concluído: 1 mudança(s) fora do loop. O passo ${auditVerdictStep} dá a cor da execução.`,
      )
      expect(run.verdict?.status).toBe(1)
      expect(run.verdict?.stdout).toContain(
        `Veredito: 1 mudança(s) em main fora do loop, registradas em issue pelo passo ${auditJudgeStep}. A execução fica vermelha.`,
      )
      expect(run.status).toBe(1)
    })

    test('Julgar fails and leaves no count when it is interrupted, even over an old one, and names the re-run', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      writeFileSync(history.verdictFile, '0\n')
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: { fail: { [`pulls:${direct}`]: 'auth' } },
      })
      expect(run.judge).toBe(1)
      expect(run.count).toBeNull()
      expect(run.verdict).toBeNull()
      expect(run.stdout).toContain(
        `Nenhuma issue foi aberta. Re-rode esta execução (gh run rerun ${RUN_ID} --repo ${REPO}): ela não duplica issue.`,
      )
      // Veredito, were it run anyway, would find nothing to pass on.
      const verdict = await history.verdict()
      expect(verdict.status).toBe(1)
      expect(verdict.stdout).toContain(
        `o passo ${auditJudgeStep} não deixou a contagem`,
      )
    })

    test('Julgar fails and leaves no count when opening an issue fails, and names the re-run', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const title = auditTitleFor(direct)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: {
          answers: { ...pullsOf(direct), [`search:${title}`]: [] },
          fail: { [`create:${title}`]: 'forbidden' },
        },
      })
      expect(run.judge).toBe(1)
      expect(run.count).toBeNull()
      expect(run.stdout).toContain(
        `Re-rode esta execução (gh run rerun ${RUN_ID} --repo ${REPO}): ela não duplica as issues já abertas.`,
      )
    })

    test.for<[string, string]>([
      ['a count of zero', '0\n'],
      ['a count with no newline', '0'],
    ])('Veredito passes on %s', async ([, text], { expect, fresh }) => {
      const history = await fresh()
      writeFileSync(history.verdictFile, text)
      const verdict = await history.verdict()
      expect(verdict.status).toBe(0)
    })

    test.for<[string, string | null]>([
      ['no count at all', null],
      ['a count that is no number', 'dois\n'],
      ['an empty count', ''],
      ['a negative count', '-1\n'],
    ])('Veredito goes red on %s', async ([, text], { expect, fresh }) => {
      const history = await fresh()
      if (text !== null) writeFileSync(history.verdictFile, text)
      const verdict = await history.verdict()
      expect(verdict.status).toBe(1)
      expect(verdict.stdout).toContain('Re-rode esta execução')
    })

    test('Veredito refuses a RUNNER_TEMP that is no absolute path with exit 2', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      writeFileSync(history.verdictFile, '0\n')
      for (const temp of [undefined, 'runner-temp']) {
        const verdict = await history.verdict({ RUNNER_TEMP: temp })
        expect(verdict.status).toBe(2)
        expect(verdict.stderr).toContain('RUNNER_TEMP')
      }
    })
  })

  // -------------------------------------------------------------------------
  // In the loop

  describe.concurrent('in the loop', () => {
    test('passes a merged PR that closes an issue with its checks green, and judges only the merge', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      // The fake refuses any question about the branch commit beneath.
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: { answers: mergedAndClosing(merge, 11) },
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual(['audits', `pulls:${merge}`, 'pr:11'])
      // The checks are read on the PR's head, not on the merge.
      expect(run.calls[2].head).toBe(headOf(11))
      expect(run.stdout).toContain(
        `- ${sha7(merge)}: PR #11, fecha #5, checks exigidos verdes`,
      )
      expect(run.stdout).toContain(
        'Resultado: tudo o que chegou em main veio de uma PR que fecha uma issue, mergeada com os checks exigidos verdes.',
      )
      expect(run.judge).toBe(0)
      expect(run.count).toBe('0\n')
      expect(run.verdict?.stdout).toContain(
        'Veredito: nada chegou em main fora do loop.',
      )
    })

    test('judges every merge of a push, oldest first', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const two = await history.merge(one, 12)
      const run = await history.audit({
        before: baseline,
        after: two,
        baseline,
        fixture: {
          answers: {
            ...mergedAndClosing(one, 11),
            ...mergedAndClosing(two, 12),
          },
        },
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual([
        'audits',
        `pulls:${one}`,
        'pr:11',
        `pulls:${two}`,
        'pr:12',
      ])
    })

    test.for<[string, string]>([
      ['exactly the closing line', 'Closes #5.\n\n## Risco\n\nNORMAL.'],
      ['the closing line after blank lines', '\n\nCloses #5.\n'],
    ])(
      'passes a PR with no closing reference when its body opens with %s and #5 is an issue',
      async ([, body], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              ...prAnswer(11, { closes: [], body }),
              ...greenOn(headOf(11)),
              'issueRef:5': { number: 5, title: 'Uma issue', state: 'open' },
            },
          },
        })
        expect(run.status, run.out).toBe(0)
        expect(keys(run.calls)).toEqual([
          'audits',
          `pulls:${merge}`,
          'pr:11',
          'issueRef:5',
        ])
        expect(run.stdout).toContain(
          'PR #11, fecha #5 pela primeira linha do corpo',
        )
        expect(created(run.calls)).toEqual([])
      },
    )

    test('passes a PR whose closing references pass one page when the page holds an issue of this repository', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(merge, pull(11, merge)),
            'pr:11': {
              ...mergeFields(11),
              number: 11,
              body: 'Resumo.',
              closingIssuesReferences: {
                totalCount: 101,
                nodes: [...foreignRefs(50), ownRef(5), ...foreignRefs(50)],
              },
            },
            ...greenOn(headOf(11)),
          },
        },
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual(['audits', `pulls:${merge}`, 'pr:11'])
      expect(run.stdout).toContain('PR #11, fecha #5, checks exigidos verdes')
      expect(created(run.calls)).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Out of the loop

  describe.concurrent('out of the loop', () => {
    test('opens an issue for a PR that closes no issue, and goes red', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(merge, pull(11, merge)),
            // Closes #5. is in the body, but not on its first line.
            ...prAnswer(11, { closes: [], body: 'Resumo.\n\nCloses #5.' }),
            ...greenOn(headOf(11)),
            ...filed(merge),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        `pulls:${merge}`,
        'pr:11',
        `search:${auditTitleFor(merge)}`,
        `create:${auditTitleFor(merge)}`,
      ])
      const [issue] = created(run.calls)
      expect(issue.argv).toEqual([
        'issue',
        'create',
        '--repo',
        REPO,
        '--title',
        `Mudança em main fora do loop: ${sha7(merge)}`,
        '--label',
        'bug',
        '--label',
        'needs-triage',
        '--body-file',
        issue.argv[11],
      ])
      expect(issue.body).toContain('- PR #11 não fecha issue.')
      expect(run.stdout).toContain(
        `- ${sha7(merge)}: registrada em https://github.com/${REPO}/issues/901`,
      )
    })

    test.for<[string, string]>([
      ['no final period', 'Closes #5'],
      ['a lower-case keyword', 'closes #5.'],
      ['another keyword', 'Fixes #5.'],
      ['more text on the line', 'Closes #5. E mais.'],
    ])(
      'opens an issue when the first body line has %s and no reference closes',
      async ([, body], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              ...prAnswer(11, { closes: [], body }),
              ...greenOn(headOf(11)),
              ...filed(merge),
            },
          },
        })
        expect(run.status, run.out).toBe(1)
        expect(created(run.calls)).toHaveLength(1)
      },
    )

    test('does not count an issue of another repository as closed', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(merge, pull(11, merge)),
            ...prAnswer(11, {
              closes: [5],
              repo: 'geazioliveira/lite-campaign',
              body: 'Resumo.',
            }),
            ...greenOn(headOf(11)),
            ...filed(merge),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(run.stdout).toContain('PR #11 não fecha issue')
    })

    // 100 references of another repository fill the page GitHub sends, and
    // #5 of this one is the 101st, which it does not send: the page is not
    // the whole list, so the audit cannot say the PR closes an issue. A
    // re-run would read the same page, so this is no interruption (#12): the
    // merge is out of the loop with that reason, Julgar succeeds, and the
    // next audit starts after it. The first body line is not asked, as it
    // only counts when the references hold none.
    test.for<[string, string]>([
      ['no closing line', 'Resumo.'],
      ['a closing line', 'Closes #5.'],
    ])(
      'files an issue when the closing references pass one page and none read is this repository (%s)',
      async ([, body], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              'pr:11': {
                ...mergeFields(11),
                number: 11,
                body,
                closingIssuesReferences: {
                  totalCount: 101,
                  nodes: [...foreignRefs(100), ownRef(5)],
                },
              },
              ...greenOn(headOf(11)),
              'issueRef:5': { number: 5, title: 'Uma issue', state: 'open' },
              ...filed(merge),
            },
          },
        })
        expect(run.judge, run.out).toBe(0)
        expect(run.status).toBe(1)
        expect(run.count).toBe('1\n')
        expect(keys(run.calls)).toEqual([
          'audits',
          `pulls:${merge}`,
          'pr:11',
          `search:${auditTitleFor(merge)}`,
          `create:${auditTitleFor(merge)}`,
        ])
        expect(run.stdout).not.toContain('Auditoria interrompida')
        const [issue] = created(run.calls)
        expect(issue.body).toContain(
          `- PR #11: mais de ${auditClosingPage} referências de fechamento, não lidas todas, e nenhuma das lidas é issue deste repositório.`,
        )
        expect(issue.body).not.toContain('não fecha issue')
        expect(issue.body).not.toContain('mergeada sem')
      },
    )

    test.for<[string, Record<string, unknown>]>([
      ['no totalCount', { nodes: [ownRef(5)] }],
      ['a totalCount below its nodes', { totalCount: 0, nodes: [ownRef(5)] }],
    ])(
      'the fake gh refuses closing references with %s',
      async ([, closingIssuesReferences], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        await expect(
          history.audit({
            before: baseline,
            after: merge,
            baseline,
            fixture: {
              answers: {
                ...pullsOf(merge, pull(11, merge)),
                'pr:11': {
                  ...mergeFields(11),
                  number: 11,
                  body: 'Closes #5.',
                  closingIssuesReferences,
                },
                ...greenOn(headOf(11)),
              },
            },
          }),
        ).rejects.toThrow(
          'pr:11: a fixture dá pullRequest.closingIssuesReferences sem um totalCount',
        )
      },
    )

    test.for<[string, (sha: string, other: string) => unknown[]]>([
      ['no PR at all', () => []],
      [
        'a branch commit of a merged PR pushed straight to main',
        (_, other) => [pull(11, other)],
      ],
      [
        'a PR merged into another base',
        (sha) => [pull(11, sha, { base: { ref: 'develop' } })],
      ],
      [
        'an open PR',
        (sha) => [pull(11, sha, { state: 'open', merged_at: null })],
      ],
    ])(
      'opens an issue for a direct commit, asking once since it has one parent: %s',
      async ([, prs], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const direct = await history.commit('Edição pela web', baseline)
        const other = await history.commit('Outro commit', baseline)
        const run = await history.audit({
          before: baseline,
          after: direct,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(direct, ...prs(direct, other)),
              ...filed(direct),
            },
          },
        })
        expect(run.status, run.out).toBe(1)
        expect(keys(run.calls)).toEqual([
          'audits',
          `pulls:${direct}`,
          `search:${auditTitleFor(direct)}`,
          `create:${auditTitleFor(direct)}`,
        ])
        expect(run.stdout).toContain(
          `- ${sha7(direct)}: commit direto em main, sem PR`,
        )
      },
    )

    test('writes the issue body in pt-BR: what happened, the range, the rule and the choice', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: { answers: { ...pullsOf(direct), ...filed(direct) } },
      })
      const [issue] = created(run.calls)
      const body = issue.body ?? ''
      expect(body).toContain('## O que acontece')
      expect(body).toContain(
        `[\`${sha7(direct)}\`](https://github.com/${REPO}/commit/${direct})`,
      )
      expect(body).toContain('- commit direto em main, sem PR.')
      expect(body).toContain(
        `https://github.com/${REPO}/compare/${baseline}...${direct}`,
      )
      expect(body).toContain('Evento: `push`.')
      expect(body).toContain(
        `Execução da auditoria: https://github.com/${REPO}/actions/runs/${RUN_ID}`,
      )
      expect(body).toContain('## A regra')
      expect(body).toContain(
        'Toda mudança em `main` vem de uma PR que fecha uma issue, mergeada por merge commit com os checks exigidos verdes',
      )
      expect(body).toContain('## O que o dono decide')
      expect(body).toContain('**Registrar retroativamente**')
      expect(body).toContain('**Reverter**')
      expect(body).toContain(
        'com `needs-triage`. Ao publicar um plano completo nesta issue, o agente troca `needs-triage` por `ready-for-human`',
      )
      expect(body).toContain(
        'só o dono escreve o Approve e aplica `ready-for-agent`',
      )
      expect(body).not.toContain('Só o dono move a label de estado.')
      // The body file is the script's own, and it is gone afterwards.
      expect(existsSync(issue.argv[11])).toBe(false)
    })

    test('opens an issue only for the commit out of the loop in a mixed push', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const direct = await history.commit('Hotfix direto', merge)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: {
          answers: {
            ...mergedAndClosing(merge, 11),
            ...pullsOf(direct),
            ...filed(direct),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(created(run.calls).map((call) => call.argv[5])).toEqual([
        auditTitleFor(direct),
      ])
    })

    test('opens the issue when the search finds only a longer title', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const title = auditTitleFor(direct)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(direct),
            [`search:${title}`]: [
              { number: 77, title: `${title} (revertida)`, body: '' },
            ],
            [`create:${title}`]: 902,
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(created(run.calls)).toHaveLength(1)
      expect(commented(run.calls)).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // The closing line's number

  describe.concurrent(
    'the closing line of a PR with no closing reference',
    () => {
      test.for<[string, Record<string, unknown>, Fixture['fail'], string]>([
        [
          'a pull request',
          {
            'issueRef:10': {
              number: 10,
              title: 'Loop mínimo',
              pull_request: {
                url: `https://api.github.com/repos/${REPO}/pulls/10`,
              },
            },
          },
          {},
          'cita #10, que é uma PR',
        ],
        [
          'a number with nothing behind it',
          {},
          { 'issueRef:10': 'notFound' },
          'cita #10, que não é uma issue deste repositório',
        ],
      ])(
        'opens an issue when the number is %s',
        async ([, answers, fail, reason], { expect, fresh }) => {
          const history = await fresh()
          const { baseline } = await preLoop(history)
          const merge = await history.merge(baseline, 11)
          const run = await history.audit({
            before: baseline,
            after: merge,
            baseline,
            fixture: {
              answers: {
                ...pullsOf(merge, pull(11, merge)),
                ...prAnswer(11, { closes: [], body: 'Closes #10.' }),
                ...greenOn(headOf(11)),
                ...answers,
                ...filed(merge),
              },
              fail,
            },
          })
          expect(run.status, run.out).toBe(1)
          expect(keys(run.calls)).toEqual([
            'audits',
            `pulls:${merge}`,
            'pr:11',
            'issueRef:10',
            `search:${auditTitleFor(merge)}`,
            `create:${auditTitleFor(merge)}`,
          ])
          expect(created(run.calls)[0].body).toContain(
            `- PR #11 não fecha issue: a primeira linha do corpo ${reason}.`,
          )
        },
      )

      test('goes red and opens nothing when GitHub cannot say what the number is', async ({
        expect,
        fresh,
      }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              ...prAnswer(11, { closes: [], body: 'Closes #5.' }),
              ...greenOn(headOf(11)),
            },
            fail: { 'issueRef:5': 'auth' },
          },
        })
        expect(run.status).toBe(1)
        expect(run.stdout).toContain('Auditoria interrompida')
        expect(run.stdout).toContain('Bad credentials')
        expect(created(run.calls)).toEqual([])
      })
    },
  )

  // -------------------------------------------------------------------------
  // The required checks, on the PR's head, at the merge

  describe.concurrent('required checks', () => {
    const at = (time: string) => `2026-09-25T${time}:00Z`

    test.for<[string, CheckRun[], string[]]>([
      [
        'issue-link red',
        [
          { ...ISSUE_LINK, conclusion: 'FAILURE' },
          { ...QUALITY, conclusion: 'SUCCESS' },
        ],
        ['Vínculo com issue / issue-link'],
      ],
      [
        'the quality check red',
        [
          { ...ISSUE_LINK, conclusion: 'SUCCESS' },
          { ...QUALITY, conclusion: 'FAILURE' },
        ],
        ['Qualidade / check'],
      ],
      [
        'no check at all',
        [],
        ['Vínculo com issue / issue-link', 'Qualidade / check'],
      ],
      [
        'the job name green only in another workflow',
        [
          { ...ISSUE_LINK, conclusion: 'SUCCESS' },
          { workflow: 'Outro', job: 'check', conclusion: 'SUCCESS' },
        ],
        ['Qualidade / check'],
      ],
      [
        'issue-link green, then red before the merge',
        [
          {
            ...ISSUE_LINK,
            conclusion: 'SUCCESS',
            startedAt: at('00:40'),
            completedAt: at('00:45'),
          },
          {
            ...ISSUE_LINK,
            conclusion: 'FAILURE',
            startedAt: at('00:50'),
            completedAt: at('00:55'),
          },
          { ...QUALITY, conclusion: 'SUCCESS' },
        ],
        ['Vínculo com issue / issue-link'],
      ],
      [
        'issue-link green only after the merge',
        [
          { ...ISSUE_LINK, conclusion: 'FAILURE' },
          {
            ...ISSUE_LINK,
            conclusion: 'SUCCESS',
            startedAt: at('01:05'),
            completedAt: at('01:06'),
          },
          { ...QUALITY, conclusion: 'SUCCESS' },
        ],
        ['Vínculo com issue / issue-link'],
      ],
      [
        'issue-link still running when the PR merged',
        [
          {
            ...ISSUE_LINK,
            conclusion: 'SUCCESS',
            startedAt: at('00:59'),
            completedAt: at('01:02'),
          },
          { ...QUALITY, conclusion: 'SUCCESS' },
        ],
        ['Vínculo com issue / issue-link'],
      ],
      [
        'issue-link cancelled',
        [
          { ...ISSUE_LINK, conclusion: 'CANCELLED' },
          { ...QUALITY, conclusion: 'SUCCESS' },
        ],
        ['Vínculo com issue / issue-link'],
      ],
    ])(
      'opens an issue for a PR merged with %s',
      async ([, runs, missing], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              ...prAnswer(11),
              ...checksOn(headOf(11), runs),
              ...filed(merge),
            },
          },
        })
        expect(run.status, run.out).toBe(1)
        const [issue] = created(run.calls)
        for (const check of missing)
          expect(issue.body).toContain(`- PR #11 mergeada sem ${check} verde.`)
        expect(issue.body?.match(/mergeada sem/g)).toHaveLength(missing.length)
      },
    )

    test.for<[string, Origin]>([
      [
        'a pull_request run of issue-link.yml (a trigger the PR gave it)',
        { event: 'pull_request' },
      ],
      [
        'a pull_request_target run of another file of the same name',
        { file: '.github/workflows/vinculo.yml' },
      ],
      ['a run GitHub names no workflow file for', { file: null }],
    ])(
      'does not count a green issue-link from %s after the red one from main',
      async ([, origin], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              ...prAnswer(11),
              ...checksOn(headOf(11), [
                { ...ISSUE_LINK, conclusion: 'FAILURE' },
                {
                  ...ISSUE_LINK,
                  ...origin,
                  conclusion: 'SUCCESS',
                  startedAt: at('00:56'),
                  completedAt: at('00:57'),
                },
                { ...QUALITY, conclusion: 'SUCCESS' },
              ]),
              ...filed(merge),
            },
          },
        })
        expect(run.status, run.out).toBe(1)
        const [issue] = created(run.calls)
        expect(issue.body).toContain(
          '- PR #11 mergeada sem Vínculo com issue / issue-link verde.',
        )
        expect(issue.body?.match(/mergeada sem/g)).toHaveLength(1)
      },
    )

    test('counts the quality check from the PR itself, on pull_request, by its names', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(merge, pull(11, merge)),
            ...prAnswer(11),
            ...checksOn(headOf(11), [
              { ...ISSUE_LINK, conclusion: 'SUCCESS' },
              {
                ...QUALITY,
                conclusion: 'SUCCESS',
                event: 'pull_request',
                file: '.github/workflows/outro.yml',
              },
            ]),
          },
        },
      })
      expect(run.status, run.out).toBe(0)
    })

    test.for<[string, Record<string, unknown>]>([
      [
        'an older red run and a green one before the merge',
        checksOn(headOf(11), [
          {
            ...ISSUE_LINK,
            conclusion: 'FAILURE',
            startedAt: at('00:40'),
            completedAt: at('00:45'),
          },
          { ...ISSUE_LINK, conclusion: 'SUCCESS' },
          { ...QUALITY, conclusion: 'SUCCESS' },
        ]),
      ],
      [
        'a green run, whatever ran after the merge (an edit to the merged PR)',
        checksOn(headOf(11), [
          { ...ISSUE_LINK, conclusion: 'SUCCESS' },
          {
            ...ISSUE_LINK,
            conclusion: 'FAILURE',
            startedAt: at('01:10'),
            completedAt: at('01:12'),
          },
          { ...QUALITY, conclusion: 'SUCCESS' },
        ]),
      ],
      [
        'a red run re-run green in the same suite',
        {
          [`checks:${headOf(11)}`]: {
            checkSuites: {
              totalCount: 2,
              nodes: [
                suite(ISSUE_LINK.workflow, [
                  {
                    job: ISSUE_LINK.job,
                    conclusion: 'FAILURE',
                    startedAt: at('00:40'),
                    completedAt: at('00:45'),
                  },
                  { job: ISSUE_LINK.job, conclusion: 'SUCCESS' },
                ]),
                suite(QUALITY.workflow, [
                  { job: QUALITY.job, conclusion: 'SUCCESS' },
                ]),
              ],
            },
          },
        },
      ],
    ])(
      'passes a PR whose checks were green at the merge after %s',
      async ([, checks], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              ...prAnswer(11),
              ...checks,
            },
          },
        })
        expect(run.status, run.out).toBe(0)
        expect(created(run.calls)).toEqual([])
      },
    )

    test('treats a head commit GitHub does not have as holding no check', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(merge, pull(11, merge)),
            ...prAnswer(11),
            [`checks:${headOf(11)}`]: null,
            ...filed(merge),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(created(run.calls)[0].body?.match(/mergeada sem/g)).toHaveLength(2)
    })

    test('puts every reason of one merge into one issue', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(merge, pull(11, merge)),
            ...prAnswer(11, { closes: [], body: 'Resumo.' }),
            ...checksOn(headOf(11), [{ ...ISSUE_LINK, conclusion: 'FAILURE' }]),
            ...filed(merge),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      const issues = created(run.calls)
      expect(issues).toHaveLength(1)
      expect(issues[0].body).toContain('- PR #11 não fecha issue.')
      expect(issues[0].body).toContain(
        '- PR #11 mergeada sem Vínculo com issue / issue-link verde.',
      )
      expect(issues[0].body).toContain(
        '- PR #11 mergeada sem Qualidade / check verde.',
      )
    })

    // A check on an unread page may be the latest run of a required job, so
    // a partial page is judged neither green nor red: the page read here has
    // the issue-link red, and still no "mergeada sem" reason comes of it. The
    // merge is out of the loop for the unread page alone, and the next audit
    // starts after it (#12).
    test.for<[string, (checks: HeadChecks) => unknown, string]>([
      [
        'check suites',
        ({ checkSuites }) => ({
          checkSuites: { ...checkSuites, totalCount: auditChecksPage + 1 },
        }),
        `- PR #11: mais de ${auditChecksPage} check suites na head ${sha7(headOf(11))}, não lidas todas.`,
      ],
      [
        'check runs in one suite',
        ({ checkSuites }) => ({
          checkSuites: {
            ...checkSuites,
            nodes: checkSuites.nodes.map((node, i) =>
              i === 0
                ? {
                    ...node,
                    checkRuns: {
                      ...node.checkRuns,
                      totalCount: auditChecksPage + 1,
                    },
                  }
                : node,
            ),
          },
        }),
        `- PR #11: mais de ${auditChecksPage} check runs numa check suite da head ${sha7(headOf(11))}, não lidos todos.`,
      ],
    ])(
      'files an issue, judging no check, when the head holds more %s than one page',
      async ([, grow, reason], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const checks = checksOn(headOf(11), [
          { ...ISSUE_LINK, conclusion: 'FAILURE' },
          { ...QUALITY, conclusion: 'SUCCESS' },
        ])[`checks:${headOf(11)}`]
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              ...prAnswer(11),
              [`checks:${headOf(11)}`]: grow(checks),
              ...filed(merge),
            },
          },
        })
        expect(run.judge, run.out).toBe(0)
        expect(run.status).toBe(1)
        expect(run.count).toBe('1\n')
        expect(run.stdout).not.toContain('Auditoria interrompida')
        const issues = created(run.calls)
        expect(issues).toHaveLength(1)
        expect(issues[0].body).toContain(reason)
        expect(issues[0].body).not.toContain('mergeada sem')
        expect(issues[0].body).not.toContain('não fecha issue')
      },
    )
  })

  // -------------------------------------------------------------------------
  // A merge GitHub has not linked to its PR yet

  describe.concurrent('a merge not linked yet', () => {
    test('asks again, and passes the merge once GitHub links it', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: { ...prAnswer(11), ...greenOn(headOf(11)) },
          sequences: { [`pulls:${merge}`]: [[], [], [pull(11, merge)]] },
        },
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual([
        'audits',
        `pulls:${merge}`,
        `pulls:${merge}`,
        `pulls:${merge}`,
        'pr:11',
      ])
      expect(created(run.calls)).toEqual([])
    })

    test("judges a merge GitHub never links as a direct commit after the contract's retries", async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: { answers: { ...pullsOf(merge), ...filed(merge) } },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        ...Array.from({ length: auditLinkRetries + 1 }, () => `pulls:${merge}`),
        `search:${auditTitleFor(merge)}`,
        `create:${auditTitleFor(merge)}`,
      ])
      expect(created(run.calls)[0].body).toContain(
        '- commit direto em main, sem PR.',
      )
      expect(run.stdout).toContain(
        `GitHub não ligou o merge ${sha7(merge)} a nenhuma PR depois de ${auditLinkRetries + 1} consultas.`,
      )
    })

    test('waits AUDIT_RETRY_DELAY_MS before asking again', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        env: { AUDIT_RETRY_DELAY_MS: '800' },
        fixture: {
          answers: { ...prAnswer(11), ...greenOn(headOf(11)) },
          sequences: { [`pulls:${merge}`]: [[], [pull(11, merge)]] },
        },
      })
      expect(run.status, run.out).toBe(0)
      const asks = run.calls.filter((call) => call.key === `pulls:${merge}`)
      expect(asks).toHaveLength(2)
      expect(asks[1].at - asks[0].at).toBeGreaterThanOrEqual(800)
    })

    test("waits the contract's delay when AUDIT_RETRY_DELAY_MS is not set", async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        env: { AUDIT_RETRY_DELAY_MS: undefined },
        fixture: {
          answers: { ...prAnswer(11), ...greenOn(headOf(11)) },
          sequences: { [`pulls:${merge}`]: [[], [pull(11, merge)]] },
        },
      })
      expect(run.status, run.out).toBe(0)
      const asks = run.calls.filter((call) => call.key === `pulls:${merge}`)
      expect(asks).toHaveLength(2)
      expect(asks[1].at - asks[0].at).toBeGreaterThanOrEqual(auditRetryDelayMs)
    })
  })

  // -------------------------------------------------------------------------
  // Where the range starts

  describe.concurrent('the range', () => {
    test('judges a push that started no run together with the next push, from the last audited run', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const audited = await history.merge(baseline, 11)
      // Pushed with a skip token in its message: it started no run of its own.
      const skipped = await history.commit('Hotfix [skip ci]', audited)
      const merge = await history.merge(skipped, 12)
      const run = await history.audit({
        before: skipped,
        after: merge,
        baseline,
        audits: [auditRun(900, audited)],
        fixture: {
          answers: {
            ...pullsOf(skipped),
            ...mergedAndClosing(merge, 12),
            ...filed(skipped),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        'jobs:900',
        `pulls:${skipped}`,
        `pulls:${merge}`,
        'pr:12',
        `search:${auditTitleFor(skipped)}`,
        `create:${auditTitleFor(skipped)}`,
      ])
      expect(run.calls[1].argv).toEqual([
        'api',
        `repos/${REPO}/actions/runs/900/jobs?filter=all&per_page=100`,
      ])
      expect(run.stdout).toContain(
        `Intervalo auditado: ${sha7(audited)}..${sha7(merge)}, desde a última auditoria (execução 900).`,
      )
      expect(created(run.calls)[0].body).toContain(
        `https://github.com/${REPO}/compare/${audited}...${merge}`,
      )
    })

    test.for<[string, boolean, { conclusion: string; judge: StepConclusion }]>([
      ['a green run', true, { conclusion: 'success', judge: 'success' }],
      [
        'a red run whose Julgar succeeded (it found changes out of the loop)',
        true,
        { conclusion: 'failure', judge: 'success' },
      ],
      [
        'a run cancelled after its Julgar succeeded',
        true,
        { conclusion: 'cancelled', judge: 'success' },
      ],
      [
        'a red run whose Julgar failed (it was interrupted)',
        false,
        { conclusion: 'failure', judge: 'failure' },
      ],
      [
        'a run cancelled during Julgar',
        false,
        { conclusion: 'cancelled', judge: 'cancelled' },
      ],
      [
        'a run whose Julgar never ran',
        false,
        { conclusion: 'failure', judge: 'skipped' },
      ],
      [
        'a run with no Julgar step at all',
        false,
        { conclusion: 'startup_failure', judge: null },
      ],
    ])(
      '%s counts as audited: %s',
      async ([, counts, ended], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const one = await history.merge(baseline, 11)
        const two = await history.merge(one, 12)
        const three = await history.merge(two, 13)
        const run = await history.audit({
          before: two,
          after: three,
          baseline,
          audits: [auditRun(901, two, ended), auditRun(900, one)],
          fixture: {
            answers: {
              ...mergedAndClosing(two, 12),
              ...mergedAndClosing(three, 13),
            },
          },
        })
        expect(run.status, run.out).toBe(0)
        expect(keys(run.calls)).toEqual(
          counts
            ? ['audits', 'jobs:901', `pulls:${three}`, 'pr:13']
            : [
                'audits',
                'jobs:901',
                'jobs:900',
                `pulls:${two}`,
                'pr:12',
                `pulls:${three}`,
                'pr:13',
              ],
        )
      },
    )

    test('starts at the newest run older than this one, never at this run nor a later one', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const two = await history.merge(one, 12)
      const three = await history.merge(two, 13)
      const run = await history.audit({
        before: two,
        after: three,
        baseline,
        // Oldest first, and this very run listed too (an earlier attempt),
        // and one after it.
        audits: [
          auditRun(900, one),
          auditRun(901, two),
          auditRun(RUN_ID, three),
          auditRun(RUN_ID + 1, three),
        ],
        fixture: { answers: mergedAndClosing(three, 13) },
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual([
        'audits',
        'jobs:901',
        `pulls:${three}`,
        'pr:13',
      ])
      expect(run.stdout).toContain('desde a última auditoria (execução 901)')
    })

    test('an interrupted push, the schedule after it and its re-run: the direct commit it brought gets its issue', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const audited = await history.merge(baseline, 11)
      const direct = await history.commit('Edição pela web', audited)
      const title = auditTitleFor(direct)

      // Run 100, on the push that brought it, stops on a gh failure.
      const push = await history.audit({
        before: audited,
        after: direct,
        baseline,
        env: { GITHUB_RUN_ID: '100' },
        audits: [auditRun(99, audited)],
        fixture: { fail: { [`pulls:${direct}`]: 'auth' } },
      })
      expect(push.judge).toBe(1)
      expect(push.stdout).toContain(
        `Re-rode esta execução (gh run rerun 100 --repo ${REPO})`,
      )

      // The schedule, run 101, on that same head: run 100 judged nothing.
      await history.checkout(direct)
      const schedule = await history.audit({
        event: 'schedule',
        baseline,
        env: { GITHUB_RUN_ID: '101' },
        audits: [
          auditRun(100, direct, { conclusion: 'failure', judge: 'failure' }),
          auditRun(99, audited),
        ],
        fixture: {
          answers: { ...pullsOf(direct), ...filed(direct, 902) },
        },
      })
      expect(schedule.judge, schedule.out).toBe(0)
      expect(schedule.status).toBe(1)
      expect(keys(schedule.calls)).toEqual([
        'audits',
        'jobs:100',
        'jobs:99',
        `pulls:${direct}`,
        `search:${title}`,
        `create:${title}`,
      ])

      // Run 100 re-run: it keeps its id, so it starts from run 99 again, not
      // from the schedule after it, and finds the issue on record.
      const rerun = await history.audit({
        before: audited,
        after: direct,
        baseline,
        env: { GITHUB_RUN_ID: '100' },
        audits: [
          auditRun(101, direct, { conclusion: 'failure' }),
          auditRun(99, audited),
        ],
        fixture: {
          answers: {
            ...pullsOf(direct),
            [`search:${title}`]: [
              {
                number: 902,
                title,
                body: `Execução da auditoria: https://github.com/${REPO}/actions/runs/101`,
                comments: [],
              },
            ],
            'comment:902': true,
          },
        },
      })
      expect(rerun.judge, rerun.out).toBe(0)
      expect(keys(rerun.calls)).toEqual([
        'audits',
        'jobs:99',
        `pulls:${direct}`,
        `search:${title}`,
        'comment:902',
      ])
      expect(rerun.stdout).toContain(
        `Intervalo auditado: ${sha7(audited)}..${sha7(direct)}, desde a última auditoria (execução 99).`,
      )
    })

    test('a re-run starts from the run before it, not from a later run on the same head', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const audited = await history.merge(baseline, 11)
      const direct = await history.commit('Edição pela web', audited)
      const run = await history.audit({
        before: audited,
        after: direct,
        baseline,
        env: { GITHUB_RUN_ID: '100' },
        audits: [auditRun(101, direct), auditRun(99, audited)],
        fixture: { answers: { ...pullsOf(direct), ...filed(direct) } },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        'jobs:99',
        `pulls:${direct}`,
        `search:${auditTitleFor(direct)}`,
        `create:${auditTitleFor(direct)}`,
      ])
    })

    test("asks about at most the contract's number of runs, newest first", async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const two = await history.merge(one, 12)
      const interrupted = Array.from({ length: auditRunsRead + 1 }, (_, i) =>
        auditRun(900 + i, one, { conclusion: 'failure', judge: 'failure' }),
      )
      const run = await history.audit({
        before: one,
        after: two,
        baseline,
        audits: interrupted,
        fixture: {
          answers: {
            ...mergedAndClosing(one, 11),
            ...mergedAndClosing(two, 12),
          },
        },
      })
      expect(run.status, run.out).toBe(0)
      const asked = keys(run.calls).filter((key) => key?.startsWith('jobs:'))
      expect(asked).toHaveLength(auditRunsRead)
      expect(asked[0]).toBe(`jobs:${900 + auditRunsRead}`)
      expect(asked).not.toContain('jobs:900')
      // Older runs exist and none judged: their ranges were never judged, so
      // the audit starts from the baseline, not from BEFORE.
      expect(run.stdout).toContain(
        `Nenhuma execução anterior da auditoria em main concluiu o passo ${auditJudgeStep} (${auditRunsRead} consultada(s)): o intervalo começa na base da auditoria, ${sha7(baseline)}.`,
      )
    })

    test('still files a direct commit that a streak of interrupted runs never judged', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const fix = await history.merge(direct, 12)
      // Every run since the direct commit failed before its Julgar ended;
      // then the fix is merged and pushed with BEFORE at the direct commit.
      const interrupted = Array.from({ length: auditRunsRead }, (_, i) =>
        auditRun(900 + i, direct, { conclusion: 'failure', judge: 'failure' }),
      )
      const run = await history.audit({
        before: direct,
        after: fix,
        baseline,
        audits: interrupted,
        fixture: {
          answers: {
            ...pullsOf(direct),
            ...mergedAndClosing(fix, 12),
            ...filed(direct),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(created(run.calls).map((issue) => issue.argv[5])).toEqual([
        auditTitleFor(direct),
      ])
    })

    test('goes red, and opens nothing, when the jobs of a run cannot be read', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        audits: [auditRun(900, baseline)],
        fixture: { fail: { 'jobs:900': 'forbidden' } },
      })
      expect(run.judge).toBe(1)
      expect(run.stdout).toContain('Auditoria interrompida')
      expect(run.stdout).toContain('os jobs da execução 900 da auditoria')
      expect(created(run.calls)).toEqual([])
    })

    test('flags a rewrite since the last audit on the tip, and judges from where the histories part', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const two = await history.merge(one, 12)
      // Main forced back to `one` and a direct commit pushed on it with a
      // skip token: no run. Then a PR merged on top of it, pushed normally.
      const rewritten = await history.commit('Reescrito à mão', one)
      const merge = await history.merge(rewritten, 13)
      const run = await history.audit({
        before: rewritten,
        after: merge,
        baseline,
        audits: [auditRun(900, two)],
        fixture: {
          answers: {
            ...pullsOf(rewritten),
            ...mergedAndClosing(merge, 13),
            ...filed(rewritten, 901),
            ...filed(merge, 902),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        'jobs:900',
        `pulls:${rewritten}`,
        `pulls:${merge}`,
        'pr:13',
        `search:${auditTitleFor(rewritten)}`,
        `create:${auditTitleFor(rewritten)}`,
        `search:${auditTitleFor(merge)}`,
        `create:${auditTitleFor(merge)}`,
      ])
      expect(run.stdout).toContain(
        `Intervalo auditado: ${sha7(one)}..${sha7(merge)}, desde o ancestral comum com a última auditoria (execução 900, em ${sha7(two)}).`,
      )
      expect(run.stdout).toContain(
        `A última auditoria (execução 900, em ${sha7(two)}) não é ancestral de ${sha7(merge)}: o intervalo começa no ancestral comum, ${sha7(one)}.`,
      )
      const [skippedIssue, tipIssue] = created(run.calls)
      expect(skippedIssue.body).toContain('- commit direto em main, sem PR.')
      expect(tipIssue.body).toContain(
        `- histórico de main reescrito desde a última auditoria (execução 900, em ${sha7(two)}).`,
      )
      expect(tipIssue.body).toContain(
        `https://github.com/${REPO}/compare/${one}...${merge}`,
      )
    })

    test('flags a rewrite with no common ancestor, and judges the history up to the tip', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const two = await history.merge(one, 12)
      const unrelated = await history.commit('Outra raiz')
      const run = await history.audit({
        before: one,
        after: two,
        baseline,
        audits: [auditRun(900, unrelated)],
        fixture: {
          answers: {
            ...mergedAndClosing(one, 11),
            ...mergedAndClosing(two, 12),
            ...filed(two),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        'jobs:900',
        `pulls:${one}`,
        'pr:11',
        `pulls:${two}`,
        'pr:12',
        `search:${auditTitleFor(two)}`,
        `create:${auditTitleFor(two)}`,
      ])
      expect(run.stdout).toContain(
        `A última auditoria (execução 900, em ${sha7(unrelated)}) não tem ancestral comum com ${sha7(two)}`,
      )
      expect(created(run.calls)[0].body).toContain(
        `- histórico de main reescrito desde a última auditoria (execução 900, em ${sha7(unrelated)}).`,
      )
    })

    test('starts a push at its BEFORE, and says so, when the last audited head is not in the clone', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const two = await history.merge(one, 12)
      const gone = 'f'.repeat(40)
      const run = await history.audit({
        before: one,
        after: two,
        baseline,
        audits: [auditRun(900, gone)],
        fixture: {
          answers: mergedAndClosing(two, 12),
          fail: { [`compare:${gone}`]: 'notFound' },
        },
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual([
        'audits',
        'jobs:900',
        `compare:${gone}`,
        `pulls:${two}`,
        'pr:12',
      ])
      expect(run.stdout).toContain(
        `A última auditoria (execução 900, em ${sha7(gone)}) não está no clone e o GitHub não a relaciona com ${sha7(two)}: o intervalo começa no topo anterior do push, ${sha7(one)}.`,
      )
    })

    // actions/checkout fetches branches and tags only: after a force-push the
    // last audited head is on no ref, so the clone lacks it. GitHub still
    // compares it, and that is how the rewrite is seen.
    test('flags a rewrite GitHub reports when the last audited head left the clone', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const gone = 'e'.repeat(40)
      const rewritten = await history.commit('Reescrito à mão', one)
      const merge = await history.merge(rewritten, 13)
      const run = await history.audit({
        before: rewritten,
        after: merge,
        baseline,
        audits: [auditRun(900, gone)],
        fixture: {
          answers: {
            [`compare:${gone}`]: {
              status: 'diverged',
              merge_base_commit: { sha: one },
            },
            ...pullsOf(rewritten),
            ...mergedAndClosing(merge, 13),
            ...filed(rewritten, 901),
            ...filed(merge, 902),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls).slice(0, 3)).toEqual([
        'audits',
        'jobs:900',
        `compare:${gone}`,
      ])
      expect(run.stdout).toContain(
        `pelo GitHub ela não é ancestral de ${sha7(merge)}: o intervalo começa no ancestral comum, ${sha7(one)}.`,
      )
      const [skippedIssue, tipIssue] = created(run.calls)
      expect(skippedIssue.argv[5]).toBe(auditTitleFor(rewritten))
      expect(tipIssue.body).toContain(
        `- histórico de main reescrito desde a última auditoria (execução 900, em ${sha7(gone)}).`,
      )
    })

    test('goes red, and opens nothing, when GitHub cannot compare the last audited head', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const gone = 'd'.repeat(40)
      const run = await history.audit({
        before: baseline,
        after: one,
        baseline,
        audits: [auditRun(900, gone)],
        fixture: { fail: { [`compare:${gone}`]: 'forbidden' } },
      })
      expect(run.judge).toBe(1)
      expect(run.stdout).toContain('Auditoria interrompida')
      expect(created(run.calls)).toEqual([])
    })

    test('takes a workflow GitHub does not know yet (the first push that brings it) as no run before', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: mergedAndClosing(merge, 11),
          fail: { audits: 'notFound' },
        },
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual(['audits', `pulls:${merge}`, 'pr:11'])
      expect(run.stdout).toContain(
        `Nenhuma execução anterior da auditoria em main concluiu o passo ${auditJudgeStep} (0 consultada(s))`,
      )
    })

    test('starts a push at its BEFORE, and says so, when no run came before', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: { answers: mergedAndClosing(merge, 11) },
      })
      expect(run.status, run.out).toBe(0)
      expect(run.stdout).toContain(
        `Nenhuma execução anterior da auditoria em main concluiu o passo ${auditJudgeStep} (0 consultada(s)): o intervalo começa no topo anterior do push, ${sha7(baseline)}.`,
      )
    })
  })

  // -------------------------------------------------------------------------
  // The daily schedule and a dispatch audit main's HEAD

  describe.concurrent('schedule and dispatch', () => {
    test.for<AuditEvent>(['schedule', 'workflow_dispatch'])(
      '%s with no run before audits from the baseline, and never the baseline itself',
      async (event, { expect, fresh }) => {
        const history = await fresh()
        const first = await history.commit('Pré-loop')
        // The baseline is a merge, as 8d4662f (#2's PR) is: the fake refuses
        // any question about it or what lies beneath.
        const bootstrap = await history.merge(first, 10)
        const merge = await history.merge(bootstrap, 11)
        await history.checkout(merge)
        const run = await history.audit({
          event,
          baseline: bootstrap,
          fixture: { answers: mergedAndClosing(merge, 11) },
        })
        expect(run.status, run.out).toBe(0)
        expect(keys(run.calls)).toEqual(['audits', `pulls:${merge}`, 'pr:11'])
        expect(run.stdout).toContain(
          `o intervalo começa na base da auditoria, ${sha7(bootstrap)}.`,
        )
        expect(run.stdout).toContain(
          `Intervalo auditado: ${sha7(bootstrap)}..${sha7(merge)}, desde a base da auditoria.`,
        )
      },
    )

    test.for<AuditEvent>(['schedule', 'workflow_dispatch'])(
      '%s audits from the last audited run up to the checked-out HEAD, whatever AFTER holds',
      async (event, { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const one = await history.merge(baseline, 11)
        const two = await history.merge(one, 12)
        await history.checkout(two)
        const run = await history.audit({
          event,
          after: one,
          baseline,
          audits: [auditRun(900, one)],
          fixture: { answers: mergedAndClosing(two, 12) },
        })
        expect(run.status, run.out).toBe(0)
        expect(keys(run.calls)).toEqual([
          'audits',
          'jobs:900',
          `pulls:${two}`,
          'pr:12',
        ])
        expect(run.stdout).toContain(
          `Auditoria de main em ${REPO}: ${event === 'schedule' ? 'execução agendada' : 'execução manual'}`,
        )
      },
    )

    test('a schedule with nothing new since the last run passes and asks nothing more', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      await history.checkout(one)
      const run = await history.audit({
        event: 'schedule',
        baseline,
        audits: [auditRun(900, one)],
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual(['audits', 'jobs:900'])
      expect(run.stdout).toContain('Commits auditados (0):')
    })

    test('a schedule whose last audited head is off main flags the rewrite, and judges from where the histories part, not from the baseline', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const one = await history.merge(baseline, 11)
      const two = await history.merge(one, 12)
      const other = await history.commit('Fora de main', one)
      await history.checkout(two)
      const run = await history.audit({
        event: 'schedule',
        baseline,
        audits: [auditRun(900, other)],
        fixture: {
          answers: { ...mergedAndClosing(two, 12), ...filed(two) },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        'jobs:900',
        `pulls:${two}`,
        'pr:12',
        `search:${auditTitleFor(two)}`,
        `create:${auditTitleFor(two)}`,
      ])
      expect(run.stdout).toContain(
        `não é ancestral de ${sha7(two)}: o intervalo começa no ancestral comum, ${sha7(one)}.`,
      )
      expect(created(run.calls)[0].body).toContain(
        `- histórico de main reescrito desde a última auditoria (execução 900, em ${sha7(other)}).`,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Rewritten history

  describe.concurrent('force-push', () => {
    test('records a force-push on the new tip, and still judges the new commits', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const oldTip = await history.merge(baseline, 11)
      const newTip = await history.merge(baseline, 12)
      const run = await history.audit({
        before: oldTip,
        after: newTip,
        forced: 'true',
        baseline,
        fixture: {
          answers: { ...mergedAndClosing(newTip, 12), ...filed(newTip) },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        `pulls:${newTip}`,
        'pr:12',
        `search:${auditTitleFor(newTip)}`,
        `create:${auditTitleFor(newTip)}`,
      ])
      const [issue] = created(run.calls)
      expect(issue.body).toContain(
        `- force-push em main (o topo anterior era ${sha7(oldTip)}).`,
      )
      // The old tip is off main: a compare link would lead nowhere.
      expect(issue.body).not.toContain('/compare/')
      expect(issue.body).toContain(
        `o topo de \`main\` passou de \`${sha7(oldTip)}\``,
      )
    })

    test('records the force-push and says the range is unknowable when the old tip is not in the clone', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const newTip = await history.merge(baseline, 12)
      const gone = 'b'.repeat(40)
      const run = await history.audit({
        before: gone,
        after: newTip,
        forced: 'true',
        baseline,
        fixture: { answers: filed(newTip) },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        `search:${auditTitleFor(newTip)}`,
        `create:${auditTitleFor(newTip)}`,
      ])
      expect(run.stdout).toContain(
        `O intervalo ${sha7(gone)}..${sha7(newTip)} não pode ser calculado`,
      )
    })

    test('records a rewrite that was not flagged as forced', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const oldTip = await history.merge(baseline, 11)
      const newTip = await history.merge(baseline, 12)
      const run = await history.audit({
        before: oldTip,
        after: newTip,
        baseline,
        fixture: {
          answers: { ...mergedAndClosing(newTip, 12), ...filed(newTip) },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(created(run.calls)[0].body).toContain(
        'o histórico de main foi reescrito',
      )
    })

    test('puts every reason a commit has into one issue', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const oldTip = await history.merge(baseline, 11)
      const direct = await history.commit('Reescrito à mão', baseline)
      const run = await history.audit({
        before: oldTip,
        after: direct,
        forced: 'true',
        baseline,
        fixture: { answers: { ...pullsOf(direct), ...filed(direct) } },
      })
      expect(run.status, run.out).toBe(1)
      const issues = created(run.calls)
      expect(issues).toHaveLength(1)
      expect(issues[0].body).toContain('- force-push em main')
      expect(issues[0].body).toContain('- commit direto em main, sem PR.')
    })

    test('comments on the closed issue of an old commit that main is forced back to', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const merge = await history.merge(direct, 12)
      const title = auditTitleFor(direct)
      const run = await history.audit({
        before: merge,
        after: direct,
        forced: 'true',
        baseline,
        audits: [auditRun(900, merge)],
        fixture: {
          answers: {
            [`search:${title}`]: [
              {
                number: 20,
                title,
                state: 'CLOSED',
                body: `Execução da auditoria: https://github.com/${REPO}/actions/runs/800`,
                comments: [],
              },
            ],
            'comment:20': true,
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        'jobs:900',
        `search:${title}`,
        'comment:20',
      ])
      expect(created(run.calls)).toEqual([])
      const [comment] = commented(run.calls)
      expect(comment.body).toContain('## Nova ocorrência')
      expect(comment.body).toContain(
        `- force-push em main (o topo anterior era ${sha7(merge)}).`,
      )
      expect(comment.body).toContain(
        `- histórico de main reescrito desde a última auditoria (execução 900, em ${sha7(merge)}).`,
      )
      expect(comment.body).toContain(
        `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
      )
    })
  })

  // -------------------------------------------------------------------------
  // The baseline

  describe.concurrent('the baseline', () => {
    test('never audits the baseline or what comes before it', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { first, baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      // The range first..merge holds the baseline itself.
      const run = await history.audit({
        before: first,
        after: merge,
        baseline,
        fixture: { answers: mergedAndClosing(merge, 11) },
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual(['audits', `pulls:${merge}`, 'pr:11'])
      expect(run.stdout).toContain(
        `1 commit(s) do intervalo vão até a base da auditoria (${sha7(baseline)})`,
      )
    })

    test('skips the whole history up to the baseline when a force-push reaches back to the root', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const unrelated = await history.commit('Outra raiz')
      const run = await history.audit({
        before: unrelated,
        after: merge,
        forced: 'true',
        baseline,
        fixture: {
          answers: { ...mergedAndClosing(merge, 11), ...filed(merge) },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        `pulls:${merge}`,
        'pr:11',
        `search:${auditTitleFor(merge)}`,
        `create:${auditTitleFor(merge)}`,
      ])
      expect(run.stdout).toContain('2 commit(s) do intervalo vão até a base')
    })

    test('defaults to the contract baseline, and audits everything when it is not in the clone', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        fixture: { answers: mergedAndClosing(merge, 11) },
      })
      expect(run.status, run.out).toBe(0)
      expect(run.stdout).toContain(
        `A base da auditoria ${sha7(auditBaseline)} não está no clone`,
      )
      expect(keys(run.calls)).toEqual(['audits', `pulls:${merge}`, 'pr:11'])
    })
  })

  // -------------------------------------------------------------------------
  // Many commits

  test('records a range past the cap once, on its tip, without judging each commit', async ({
    expect,
    fresh,
  }) => {
    const history = await fresh()
    const { baseline } = await preLoop(history)
    const tip = await history.burst(baseline, auditCommitCap + 1)
    const run = await history.audit({
      before: baseline,
      after: tip,
      baseline,
      fixture: { answers: filed(tip) },
    })
    expect(run.status, run.out).toBe(1)
    expect(keys(run.calls)).toEqual([
      'audits',
      `search:${auditTitleFor(tip)}`,
      `create:${auditTitleFor(tip)}`,
    ])
    expect(run.stdout).toContain(
      `Limite de ${auditCommitCap} commits por auditoria excedido (${auditCommitCap + 1})`,
    )
    expect(created(run.calls)[0].body).toContain(
      `acima do limite de ${auditCommitCap}`,
    )
  })

  describe.concurrent('many commits out of the loop', () => {
    test('opens one issue on the tip listing them all, past the cap', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const tip = await history.burst(baseline, auditIssueCap + 1)
      const commits = await history.line(baseline, tip)
      const run = await history.audit({
        before: baseline,
        after: tip,
        baseline,
        fixture: {
          answers: {
            ...Object.assign({}, ...commits.map((sha) => pullsOf(sha))),
            ...filed(tip),
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(keys(run.calls)).toEqual([
        'audits',
        ...commits.map((sha) => `pulls:${sha}`),
        `search:${auditTitleFor(tip)}`,
        `create:${auditTitleFor(tip)}`,
      ])
      const [issue] = created(run.calls)
      expect(issue.body).toContain(
        `A auditoria encontrou ${auditIssueCap + 1} commits fora do loop`,
      )
      for (const sha of commits)
        expect(issue.body).toContain(
          `- [\`${sha7(sha)}\`](https://github.com/${REPO}/commit/${sha}): commit direto em main, sem PR.`,
        )
      expect(run.stdout).toContain(
        `uma issue só, no topo ${sha7(tip)}, lista os ${auditIssueCap + 1}`,
      )
    })

    test('still opens one issue per commit at the cap', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const tip = await history.burst(baseline, auditIssueCap)
      const commits = await history.line(baseline, tip)
      const run = await history.audit({
        before: baseline,
        after: tip,
        baseline,
        fixture: {
          answers: Object.assign(
            {},
            ...commits.map((sha, i) => ({
              ...pullsOf(sha),
              ...filed(sha, 900 + i),
            })),
          ),
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(created(run.calls).map((call) => call.argv[5])).toEqual(
        commits.map((sha) => auditTitleFor(sha)),
      )
    })
  })

  // -------------------------------------------------------------------------
  // An issue already on record

  describe.concurrent('an issue with the same title', () => {
    test.for<[string, string]>([
      ['OPEN', 'open'],
      ['CLOSED', 'closed'],
    ])(
      'comments on it (%s) instead of opening a second one, and still goes red',
      async ([state], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const direct = await history.commit('Edição pela web', baseline)
        const title = auditTitleFor(direct)
        const run = await history.audit({
          before: baseline,
          after: direct,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(direct),
              [`search:${title}`]: [
                {
                  number: 77,
                  title,
                  state,
                  body: 'Aberta antes.',
                  comments: [],
                },
              ],
              'comment:77': true,
            },
          },
        })
        expect(run.status, run.out).toBe(1)
        expect(created(run.calls)).toEqual([])
        const [comment] = commented(run.calls)
        expect(comment.argv).toEqual([
          'issue',
          'comment',
          '77',
          '--repo',
          REPO,
          '--body-file',
          comment.argv[6],
        ])
        expect(comment.body).toContain('## Nova ocorrência')
        expect(comment.body).toContain('- commit direto em main, sem PR.')
        expect(run.stdout).toContain(
          `- ${sha7(direct)}: já registrada na #77; nova ocorrência comentada em https://github.com/${REPO}/issues/77#issuecomment-1`,
        )
      },
    )

    test.for<[string, { body: string; comments: { body: string }[] }]>([
      [
        'its body',
        {
          body: `Execução da auditoria: https://github.com/${REPO}/actions/runs/${RUN_ID}`,
          comments: [],
        },
      ],
      [
        'a comment',
        {
          body: 'Aberta antes.',
          comments: [
            {
              body: `Execução da auditoria: https://github.com/${REPO}/actions/runs/${RUN_ID}`,
            },
          ],
        },
      ],
    ])(
      'adds nothing when %s already links this very run (a re-run)',
      async ([, texts], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const direct = await history.commit('Edição pela web', baseline)
        const title = auditTitleFor(direct)
        const run = await history.audit({
          before: baseline,
          after: direct,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(direct),
              [`search:${title}`]: [{ number: 77, title, ...texts }],
            },
          },
        })
        expect(run.status, run.out).toBe(1)
        expect(keys(run.calls)).toEqual([
          'audits',
          `pulls:${direct}`,
          `search:${title}`,
        ])
        expect(run.stdout).toContain(
          `- ${sha7(direct)}: já registrada na #77 por esta execução`,
        )
      },
    )

    test('does not take a run whose id starts with this one for this run', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const title = auditTitleFor(direct)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(direct),
            [`search:${title}`]: [
              {
                number: 77,
                title,
                body: `https://github.com/${REPO}/actions/runs/${RUN_ID}1`,
                comments: [],
              },
            ],
            'comment:77': true,
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(commented(run.calls)).toHaveLength(1)
    })

    test('goes red when the comment is refused', async ({ expect, fresh }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const title = auditTitleFor(direct)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(direct),
            [`search:${title}`]: [
              { number: 77, title, body: '', comments: [] },
            ],
          },
          fail: { 'comment:77': 'forbidden' },
        },
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('Registro interrompido')
      expect(run.stdout).toContain('Resource not accessible by integration')
    })

    test('comments on the one issue of a big group when it is on record', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const tip = await history.burst(baseline, auditIssueCap + 1)
      const commits = await history.line(baseline, tip)
      const title = auditTitleFor(tip)
      const run = await history.audit({
        before: baseline,
        after: tip,
        baseline,
        fixture: {
          answers: {
            ...Object.assign({}, ...commits.map((sha) => pullsOf(sha))),
            [`search:${title}`]: [
              { number: 78, title, body: '', comments: [] },
            ],
            'comment:78': true,
          },
        },
      })
      expect(run.status, run.out).toBe(1)
      expect(created(run.calls)).toEqual([])
      const [comment] = commented(run.calls)
      for (const sha of commits) expect(comment.body).toContain(sha7(sha))
    })
  })

  // -------------------------------------------------------------------------
  // Fail-closed

  // -------------------------------------------------------------------------
  // The Copilot review on the head and the open review threads (#13)

  describe.concurrent('the review rule', () => {
    /** One merge of PR 11 on the baseline, audited with this fixture. */
    async function auditOne(
      fresh: () => Promise<History>,
      options: Parameters<typeof reviewedMerge>[2] = {},
      extra: Record<string, unknown> = {},
    ) {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: {
            ...reviewedMerge(merge, 11, options),
            ...filed(merge),
            ...extra,
          },
        },
      })
      return { run, merge, body: created(run.calls)[0]?.body ?? '' }
    }

    const noReview = `- PR #11 mergeada sem revisão do Copilot na cabeça ${sha7(headOf(11))}.`

    // With --review-report (#30), issue-link.yml goes green on a head with no
    // Copilot review, or with a thread still open. The audit reads the PR
    // itself, so a merge on that green check is still out of the loop.
    test.for<[string, { reviews?: unknown[]; threads?: unknown[] }, string]>([
      ['no Copilot review of the head', { reviews: [] }, noReview],
      [
        'a thread still open',
        { threads: [thread()] },
        'mergeada com 1 thread(s) de revisão aberta(s)',
      ],
    ])(
      'files an issue for a merge with every required check green but %s (#30)',
      async ([, options, reason], { expect, fresh }) => {
        const { run, body } = await auditOne(fresh, options)
        expect(run.status, run.out).toBe(1)
        expect(body).toContain(reason)
      },
    )

    test('passes a Copilot review of the head before the merge, with every thread resolved', async ({
      expect,
      fresh,
    }) => {
      const { run, merge } = await auditOne(fresh, {
        threads: [thread({ resolved: true }), thread({ resolved: true })],
      })
      expect(run.status, run.out).toBe(0)
      expect(keys(run.calls)).toEqual(['audits', `pulls:${merge}`, 'pr:11'])
      expect(run.stdout).toContain(
        `- ${sha7(merge)}: PR #11, fecha #5, checks exigidos verdes, revisão do Copilot na cabeça ${sha7(headOf(11))} e nenhuma thread de revisão aberta`,
      )
      expect(created(run.calls)).toEqual([])
    })

    test.for<[string, string]>([
      ['a second before it', shift(reviewRuleSince, -1)],
      ['long before it, as #11 was', '2026-09-25T04:43:52Z'],
    ])(
      'does not judge the review rule on a PR merged before reviewRuleSince: %s',
      async ([, mergedAt], { expect, fresh }) => {
        const { run, merge } = await auditOne(fresh, {
          mergedAt,
          reviews: [],
          threads: [thread({ openedAt: shift(mergedAt, -60) })],
        })
        expect(run.status, run.out).toBe(0)
        expect(run.stdout).toContain(
          `- ${sha7(merge)}: PR #11, fecha #5, checks exigidos verdes; mergeada antes da regra de revisão (${reviewRuleSince})`,
        )
        expect(created(run.calls)).toEqual([])
      },
    )

    test('judges a PR merged at reviewRuleSince itself', async ({
      expect,
      fresh,
    }) => {
      const { run, body } = await auditOne(fresh, {
        mergedAt: reviewRuleSince,
        reviews: [],
      })
      expect(run.status, run.out).toBe(1)
      expect(body).toContain(noReview)
    })

    test('files an issue when there is no review at all, and says the head', async ({
      expect,
      fresh,
    }) => {
      const { run, merge, body } = await auditOne(fresh, { reviews: [] })
      expect(run.judge, run.out).toBe(0)
      expect(run.status).toBe(1)
      expect(run.count).toBe('1\n')
      expect(keys(run.calls)).toEqual([
        'audits',
        `pulls:${merge}`,
        'pr:11',
        `search:${auditTitleFor(merge)}`,
        `create:${auditTitleFor(merge)}`,
      ])
      expect(body).toContain(noReview)
    })

    test('files an issue when Copilot reviewed only an older commit', async ({
      expect,
      fresh,
    }) => {
      const { run, body } = await auditOne(fresh, {
        reviews: [review(11, { on: 'b'.repeat(40) })],
      })
      expect(run.status, run.out).toBe(1)
      expect(body).toContain(noReview)
    })

    test('files an issue when Copilot reviewed the head only after the merge', async ({
      expect,
      fresh,
    }) => {
      const { run, body } = await auditOne(fresh, {
        reviews: [review(11, { at: shift(RULED_AT, 1) })],
      })
      expect(run.status, run.out).toBe(1)
      expect(body).toContain(noReview)
    })

    test('counts a review submitted at the very instant of the merge', async ({
      expect,
      fresh,
    }) => {
      const { run } = await auditOne(fresh, {
        reviews: [review(11, { at: RULED_AT })],
      })
      expect(run.status, run.out).toBe(0)
    })

    test('keeps an earlier review of the head when a later one came after the merge', async ({
      expect,
      fresh,
    }) => {
      const { run } = await auditOne(fresh, {
        reviews: [review(11), review(11, { at: shift(RULED_AT, 300) })],
      })
      expect(run.status, run.out).toBe(0)
    })

    test.for<[string, Record<string, unknown> | null]>([
      [
        'a User with the bot login',
        { __typename: 'User', login: copilotReviewer.login },
      ],
      [
        "a User carrying the bot's database id",
        { __typename: 'User', databaseId: copilotReviewer.databaseId },
      ],
      [
        'an Organization, which holds that login on GitHub',
        { __typename: 'Organization', login: copilotReviewer.login },
      ],
      ['another Bot', { __typename: 'Bot', databaseId: 41898282 }],
      ['a deleted account', null],
    ])(
      'files an issue when the review on the head is by %s, not by Copilot',
      async ([, author], { expect, fresh }) => {
        const { run, body } = await auditOne(fresh, {
          reviews: [review(11, { author })],
        })
        expect(run.status, run.out).toBe(1)
        expect(body).toContain(noReview)
      },
    )

    test.for(['DISMISSED', 'CHANGES_REQUESTED', 'PENDING'])(
      'files an issue when the Copilot review of the head is %s',
      async (state, { expect, fresh }) => {
        const { run, body } = await auditOne(fresh, {
          reviews: [review(11, { state })],
        })
        expect(run.status, run.out).toBe(1)
        expect(body).toContain(noReview)
      },
    )

    // The bodies of two failed Copilot reviews, as GitHub gives them
    // (keycloak/keycloak#52793 and Azure/azure-powershell#30106).
    test.for([
      'Copilot encountered an error and was unable to review this pull request. You can try again by re-requesting a review.',
      "Copilot wasn't able to review any files in this pull request.\n\n\n\n",
    ])(
      'files an issue when the only Copilot review of the head failed: %j',
      async (body, { expect, fresh }) => {
        const { run, body: issue } = await auditOne(fresh, {
          reviews: [review(11, { body })],
        })
        expect(run.status, run.out).toBe(1)
        expect(issue).toContain(noReview)
      },
    )

    test('passes a good Copilot review of the head when a later one of it failed', async ({
      expect,
      fresh,
    }) => {
      const { run } = await auditOne(fresh, {
        reviews: [
          review(11, { at: shift(RULED_AT, -120) }),
          review(11, {
            body: 'Copilot encountered an error and was unable to review this pull request.',
          }),
        ],
      })
      expect(run.status, run.out).toBe(0)
    })

    test('passes an APPROVED Copilot review of the head', async ({
      expect,
      fresh,
    }) => {
      const { run } = await auditOne(fresh, {
        reviews: [review(11, { state: 'APPROVED' })],
      })
      expect(run.status, run.out).toBe(0)
    })

    test('files an issue with the count of threads opened by the merge and still unresolved, outdated or not, whoever opened them', async ({
      expect,
      fresh,
    }) => {
      const { run, merge, body } = await auditOne(fresh, {
        threads: [
          thread(),
          thread({ resolved: true }),
          { ...thread(), isOutdated: true },
        ],
      })
      expect(run.status, run.out).toBe(1)
      expect(body).toContain(
        '- PR #11 mergeada com 2 thread(s) de revisão aberta(s).',
      )
      expect(body).not.toContain('sem revisão do Copilot')
      expect(run.stdout).toContain(
        `- ${sha7(merge)}: PR #11 mergeada com 2 thread(s) de revisão aberta(s)`,
      )
    })

    test('counts a thread opened at the very instant of the merge', async ({
      expect,
      fresh,
    }) => {
      const { run, body } = await auditOne(fresh, {
        threads: [thread({ openedAt: RULED_AT })],
      })
      expect(run.status, run.out).toBe(1)
      expect(body).toContain('mergeada com 1 thread(s) de revisão aberta(s)')
    })

    test('ignores a thread opened after the merge, still unresolved', async ({
      expect,
      fresh,
    }) => {
      const { run } = await auditOne(fresh, {
        threads: [thread({ openedAt: shift(RULED_AT, 1) })],
      })
      expect(run.status, run.out).toBe(0)
    })

    test('counts an unresolved thread whose opening it cannot read', async ({
      expect,
      fresh,
    }) => {
      const { run, body } = await auditOne(fresh, {
        threads: [thread({ openedAt: null })],
      })
      expect(run.status, run.out).toBe(1)
      expect(body).toContain('mergeada com 1 thread(s) de revisão aberta(s)')
    })

    test('gives both reasons when the review is missing and a thread is open', async ({
      expect,
      fresh,
    }) => {
      const { run, body } = await auditOne(fresh, {
        reviews: [],
        threads: [thread()],
      })
      expect(run.status, run.out).toBe(1)
      expect(body).toContain(noReview)
      expect(body).toContain('mergeada com 1 thread(s) de revisão aberta(s)')
    })

    // Pages read whole or not judged: a re-run would read the same page, so
    // this is no interruption, and the reason is the page (as #12 did for
    // the closing references).
    test('files an issue with the true reason when the newest page of reviews holds no Copilot review of the head', async ({
      expect,
      fresh,
    }) => {
      // The Copilot review is the oldest of 101: past the page of the newest.
      const others = Array.from({ length: auditReviewPage }, (_, i) =>
        review(11, {
          author: { __typename: 'User' },
          at: shift(RULED_AT, -3600 + i),
        }),
      )
      const { run, body } = await auditOne(fresh, {
        reviews: [review(11, { at: shift(RULED_AT, -7200) }), ...others],
      })
      expect(run.judge, run.out).toBe(0)
      expect(run.status).toBe(1)
      expect(body).toContain(
        `- PR #11: mais de ${auditReviewPage} revisões, não lidas todas, e nenhuma das ${auditReviewPage} mais recentes é do Copilot na cabeça ${sha7(headOf(11))} antes do merge.`,
      )
      expect(body).not.toContain('sem revisão do Copilot')
      expect(run.stdout).not.toContain('Auditoria interrompida')
    })

    test('passes when a Copilot review of the head is among the newest page, whatever the unread', async ({
      expect,
      fresh,
    }) => {
      const others = Array.from({ length: auditReviewPage }, (_, i) =>
        review(11, {
          author: { __typename: 'User' },
          at: shift(RULED_AT, -3600 + i),
        }),
      )
      const { run } = await auditOne(fresh, {
        reviews: [...others, review(11)],
      })
      expect(run.status, run.out).toBe(0)
    })

    test('files an issue with the true reason when the threads pass one page', async ({
      expect,
      fresh,
    }) => {
      const { run, body } = await auditOne(fresh, {
        threads: Array.from({ length: auditReviewPage + 1 }, () =>
          thread({ resolved: true }),
        ),
      })
      expect(run.judge, run.out).toBe(0)
      expect(run.status).toBe(1)
      expect(body).toContain(
        `- PR #11: mais de ${auditReviewPage} threads de revisão, não lidas todas.`,
      )
      expect(body).not.toContain('thread(s) de revisão aberta(s)')
    })

    test.for<[string, string, string]>([
      ['mergedAt', 'mergedAt', 'veio sem a data do merge'],
      ['headRefOid', 'headRefOid', 'veio sem a head'],
      ['the reviews', 'reviews', 'veio sem as revisões'],
      ['the review threads', 'reviewThreads', 'veio sem as threads de revisão'],
    ])(
      'goes red, and opens nothing, when the PR comes without %s',
      async ([, field, reason], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const answer = reviewedMerge(merge, 11)
        const node = answer['pr:11'] as Record<string, unknown>
        delete node[field]
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: { answers: { ...answer, ...filed(merge) } },
        })
        expect(run.judge).toBe(1)
        expect(run.stdout).toContain(
          `Auditoria interrompida: a consulta da PR #11 ${reason}.`,
        )
        expect(created(run.calls)).toEqual([])
      },
    )

    test('states the rule, with its date, in the output and in the issue', async ({
      expect,
      fresh,
    }) => {
      const { run, body } = await auditOne(fresh, { reviews: [] })
      expect(run.stdout).toContain(
        `Regra: toda mudança em main vem de uma PR que fecha uma issue, mergeada com os checks exigidos verdes; desde ${reviewRuleSince}, também com uma revisão do Copilot na cabeça antes do merge e nenhuma thread de revisão aberta.`,
      )
      expect(body).toContain(
        `Desde ${reviewRuleSince}, a PR também precisa de uma revisão do Copilot no commit da cabeça antes do merge e de nenhuma thread de revisão aberta, de qualquer autor.`,
      )
    })
  })

  describe.concurrent('gh failures', () => {
    test.for<
      [
        string,
        'audits' | 'pulls' | 'pr' | 'search',
        'auth' | 'unreachable',
        string,
      ]
    >([
      ['listing the audit runs', 'audits', 'auth', 'Bad credentials'],
      ['listing the PRs of a commit', 'pulls', 'auth', 'Bad credentials'],
      ['reading the PR', 'pr', 'unreachable', 'no such host'],
      ['searching for the issue', 'search', 'auth', 'Bad credentials'],
    ])(
      'goes red with the reason, and opens nothing, when %s fails',
      async ([, which, mode, reason], { expect, fresh }) => {
        const history = await fresh()
        const { baseline } = await preLoop(history)
        const merge = await history.merge(baseline, 11)
        const key = {
          audits: 'audits',
          pulls: `pulls:${merge}`,
          pr: 'pr:11',
          search: `search:${auditTitleFor(merge)}`,
        }[which]
        const run = await history.audit({
          before: baseline,
          after: merge,
          baseline,
          fixture: {
            answers: {
              ...pullsOf(merge, pull(11, merge)),
              ...prAnswer(11, { closes: [], body: 'Resumo.' }),
              ...greenOn(headOf(11)),
              ...filed(merge),
            },
            fail: { [key]: mode },
          },
        })
        expect(run.status).toBe(1)
        expect(run.stdout).toContain(reason)
        expect(created(run.calls).filter((call) => !call.failed)).toEqual([])
        expect(keys(run.calls).at(-1)).toBe(key)
      },
    )

    test('says no issue was opened when a lookup fails', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: { fail: { [`pulls:${direct}`]: 'auth' } },
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('Auditoria interrompida')
      expect(run.stdout).toContain('Nenhuma issue foi aberta')
    })

    test('says to run the audit again, with no run to name, outside a runner', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        env: { GITHUB_RUN_ID: undefined },
        fixture: { fail: { [`pulls:${direct}`]: 'auth' } },
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain(
        'Nenhuma issue foi aberta. Rode a auditoria de novo: ela não duplica issue.',
      )
    })

    test('goes red when opening the issue is refused', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      const title = auditTitleFor(direct)
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        fixture: {
          answers: { ...pullsOf(direct), [`search:${title}`]: [] },
          fail: { [`create:${title}`]: 'forbidden' },
        },
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('Registro interrompido')
      expect(run.stdout).toContain('Resource not accessible by integration')
    })

    test('still shows the issues it opened before a later one was refused', async ({
      expect,
      fresh,
    }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const first = await history.commit('Primeiro direto', baseline)
      const second = await history.commit('Segundo direto', first)
      const title = auditTitleFor(second)
      const run = await history.audit({
        before: baseline,
        after: second,
        baseline,
        fixture: {
          answers: {
            ...pullsOf(first),
            ...pullsOf(second),
            ...filed(first),
            [`search:${title}`]: [],
          },
          fail: { [`create:${title}`]: 'forbidden' },
        },
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain(
        `- ${sha7(first)}: registrada em https://github.com/${REPO}/issues/901`,
      )
      expect(run.stdout).toContain('Registro interrompido')
    })

    test('goes red when GitHub has no such PR', async ({ expect, fresh }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const merge = await history.merge(baseline, 11)
      const run = await history.audit({
        before: baseline,
        after: merge,
        baseline,
        fixture: {
          answers: { ...pullsOf(merge, pull(11, merge)), 'pr:11': null },
        },
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('Could not resolve to a PullRequest')
    })

    test('goes red when gh is not installed', async ({ expect, fresh }) => {
      const history = await fresh()
      const { baseline } = await preLoop(history)
      const direct = await history.commit('Edição pela web', baseline)
      // A PATH holding git and nothing else, so no gh, fake or real, is found.
      const which = await exec('sh', ['-c', 'command -v git'], {
        timeout: 60_000,
      })
      if (which.status !== 0)
        throw new Error(`command -v git falhou: ${which.stderr}`)
      const onlyGit = path.join(history.root, 'only-git')
      mkdirSync(onlyGit)
      symlinkSync(which.stdout.trim(), path.join(onlyGit, 'git'))
      const run = await history.audit({
        before: baseline,
        after: direct,
        baseline,
        pathOverride: onlyGit,
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain('gh não está instalado')
    })
  })
})

// ---------------------------------------------------------------------------
// The contract and the workflow

describe('the audit contract', () => {
  it('titles an issue by the short SHA', () => {
    expect(auditTitleFor('8d4662fa54b217d6471e8b197a8d15cf897f65e1')).toBe(
      'Mudança em main fora do loop: 8d4662f',
    )
  })

  it('labels an issue as a bug awaiting triage, which a report may set on creation', () => {
    expect([...auditLabels]).toEqual(['bug', 'needs-triage'])
    expect(categoryLabels).toContain(auditLabels[0])
    expect(agentCreateStateLabels).toContain(auditLabels[1])
  })

  it("pins the baseline at 8d4662f, the merge of #2's PR, by its full SHA", () => {
    expect(auditBaseline).toBe('8d4662fa54b217d6471e8b197a8d15cf897f65e1')
  })

  it('pins the values the docs state: retries, delay, runs read, steps and schedule', () => {
    expect(auditLinkRetries).toBe(3)
    expect(auditRetryDelayMs).toBe(10_000)
    expect(auditRunsRead).toBe(20)
    expect(auditJudgeStep).toBe('Julgar')
    expect(auditVerdictStep).toBe('Veredito')
    expect(auditVerdictFile).toBe('audit-verdict')
    expect(auditCron).toBe('17 6 * * *')
  })

  it('names the five strings that make GitHub skip a push or pull_request run', () => {
    expect([...skipCiTokens]).toEqual([
      '[skip ci]',
      '[ci skip]',
      '[no ci]',
      '[skip actions]',
      '[actions skip]',
    ])
  })

  it('takes the issue-link check only from issue-link.yml on pull_request_target', () => {
    expect(issueLinkEvent).toBe('pull_request_target')
    expect(issueLinkWorkflowPath).toBe('.github/workflows/issue-link.yml')
    const issueLink = readFileSync(
      path.join(projectRoot, issueLinkWorkflowPath),
      'utf8',
    )
    expect(issueLink).toMatch(new RegExp(`^on:\\n {2}${issueLinkEvent}:$`, 'm'))
    expect(issueLink).toMatch(new RegExp(`^name: ${ISSUE_LINK.workflow}$`, 'm'))
    expect(requiredChecks).toContainEqual(ISSUE_LINK)
  })

  it('holds the review rule from after the merges of #10 and #11 and before that of #14', () => {
    // Measured on GitHub: #10 and #11 merged before Copilot reviewed them
    // (their threads went to #12); #14 met the rule.
    const since = Date.parse(reviewRuleSince)
    expect(reviewRuleSince).toBe('2026-09-25T12:00:00Z')
    expect(Date.parse('2026-09-25T00:46:02Z')).toBeLessThan(since)
    expect(Date.parse('2026-09-25T04:43:52Z')).toBeLessThan(since)
    expect(Date.parse('2026-09-25T14:01:35Z')).toBeGreaterThanOrEqual(since)
    expect(auditReviewPage).toBe(100)
  })

  it('files one issue per commit up to ten, and reads the runs of its own workflow', () => {
    expect(auditIssueCap).toBe(10)
    const workflow = readFileSync(
      path.join(projectRoot, '.github', 'workflows', mainAuditWorkflowFile),
      'utf8',
    )
    expect(workflow).toMatch(/^name: Auditoria de main$/m)
  })
})

describe('.github/workflows/main-audit.yml', () => {
  const text = readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'main-audit.yml'),
    'utf8',
  )
  const runs = [...text.matchAll(/^\s+run:\s*(.+)$/gm)].map((m) => m[1])

  it('runs on every push to main, once a day and on demand, and on nothing else', () => {
    expect(text).toMatch(/^name: Auditoria de main$/m)
    expect(text).toMatch(
      /^on:\n {2}push:\n {4}branches: \[main\]\n {2}schedule:\n {4}- cron: '[^'\n]+'\n {2}workflow_dispatch:\n\n/m,
    )
    const cron = /^ {4}- cron: '([^'\n]+)'$/m.exec(text)?.[1]
    expect(cron).toBe(auditCron)
  })

  it('judges main only, whichever branch a dispatch names', () => {
    expect(text).toMatch(
      /^ {2}audit:\n {4}name: audit\n(?: {4}#.*\n)* {4}if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}\n/m,
    )
  })

  it('may read the repository, PRs, runs and checks, and write issues, nothing more', () => {
    expect(text).toMatch(
      /^permissions:\n {2}contents: read\n {2}pull-requests: read\n {2}issues: write\n {2}actions: read\n {2}checks: read\n\n/m,
    )
    // Only YAML keys count: the header comment may name a permission.
    expect(text.match(/^\s+[\w-]+:\s*write\s*$/gm)).toHaveLength(1)
  })

  it('never drops a push: one audit at a time, none cancelled', () => {
    expect(text).toMatch(
      /^concurrency:\n {2}group: main-audit\n {2}cancel-in-progress: false\n {2}queue: max\n/m,
    )
  })

  it('is no required check', () => {
    expect(text).toMatch(/^ {2}audit:\n {4}name: audit$/m)
    expect(requiredChecks.map((check) => check.job)).not.toContain('audit')
  })

  it('checks out the whole history, keeps no credential, and pins every action', () => {
    expect(text).toMatch(/^ {10}fetch-depth: 0$/m)
    expect(text).toMatch(/^ {10}persist-credentials: false$/m)
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
    expect(uses).toHaveLength(2)
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/)
  })

  it('judges in Julgar and gives the color in Veredito, which runs only after it', () => {
    const steps = text.slice(text.indexOf('    steps:\n'))
    const judge = steps.indexOf(`      - name: ${auditJudgeStep}\n`)
    const verdict = steps.indexOf(`      - name: ${auditVerdictStep}\n`)
    expect(judge).toBeGreaterThan(-1)
    expect(verdict).toBeGreaterThan(judge)
    expect(steps.slice(judge, verdict)).toMatch(
      /\n {8}run: node scripts\/audit-main\.mjs --judge\n/,
    )
    // No `if:` on Veredito: a step runs only when the ones before succeeded.
    expect(steps.slice(verdict)).toBe(
      `      - name: ${auditVerdictStep}\n        run: node scripts/audit-main.mjs --verdict\n`,
    )
  })

  it('hands the event to the script through env, never inside run', () => {
    expect(runs).toEqual([
      'node scripts/audit-main.mjs --judge',
      'node scripts/audit-main.mjs --verdict',
    ])
    for (const script of runs) expect(script).not.toContain('${{')
    for (const line of [
      'GH_TOKEN: ${{ github.token }}',
      'BEFORE: ${{ github.event.before }}',
      'AFTER: ${{ github.event.after }}',
      'FORCED: ${{ github.event.forced }}',
    ])
      expect(text).toContain(`          ${line}\n`)
  })
})
