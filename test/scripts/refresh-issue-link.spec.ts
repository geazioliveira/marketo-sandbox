import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base } from 'vitest'
import {
  issueLinkEvent,
  issueLinkWorkflowFile,
  refreshPollMs,
  refreshWaitMs,
  requiredChecks,
} from '../../scripts/loop-sections.mjs'
import { cleanEnv } from '../support/clean-env'
import { exec, projectRoot } from '../support/temp-repo'

/**
 * scripts/refresh-issue-link.mjs, driven as issue-link-refresh.yml drives it:
 * a strict fake gh (fake-gh-api.mjs) first on PATH, the input in the
 * environment, the script as a child process. It reads no git, so each case
 * needs only a scratch directory, removed when the case finishes.
 */

const REPO = 'geazioliveira/marketo-sandbox'
const ISSUE = 5
const script = path.join(projectRoot, 'scripts', 'refresh-issue-link.mjs')
const fakeGh = path.join(projectRoot, 'test', 'support', 'fake-gh-api.mjs')
const HEAD = 'c'.repeat(40)
const OTHER = 'd'.repeat(40)

interface Call {
  argv: string[]
  at: number
  key?: string
  failed?: string
  violation?: string
}

interface Fixture {
  answers?: Record<string, unknown>
  sequences?: Record<string, unknown[]>
  fail?: Record<string, 'auth' | 'unreachable' | 'forbidden' | 'notFound'>
}

interface RefreshRun {
  status: number | null
  stdout: string
  stderr: string
  calls: Call[]
}

class Scratch {
  readonly root: string
  readonly bin: string
  readonly log: string
  readonly fixturePath: string

  constructor() {
    this.root = mkdtempSync(path.join(tmpdir(), 'refresh-spec-'))
    this.bin = path.join(this.root, 'bin')
    this.log = path.join(this.root, 'gh.log')
    this.fixturePath = path.join(this.root, 'fixture.json')
    mkdirSync(this.bin, { recursive: true })
    const shim = path.join(this.bin, 'gh')
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeGh)} "$@"\n`,
    )
    chmodSync(shim, 0o755)
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true })
  }

  async refresh(
    fixture: Fixture,
    env: Record<string, string | undefined> = {},
  ): Promise<RefreshRun> {
    writeFileSync(
      this.fixturePath,
      JSON.stringify({ repo: REPO, answers: {}, ...fixture }),
    )
    rmSync(this.log, { force: true })
    const childEnv = cleanEnv(this.root, {
      bin: this.bin,
      extra: {
        FAKE_GH_LOG: this.log,
        FAKE_GH_FIXTURE: this.fixturePath,
        GH_TOKEN: 'fake-token',
        GITHUB_REPOSITORY: REPO,
        ISSUE_NUMBER: String(ISSUE),
        IS_PR: 'false',
        // No real wait: a run in progress is polled at once, and a case
        // that never finishes it names its own deadline.
        REFRESH_POLL_MS: '0',
        REFRESH_WAIT_MS: '20000',
      },
    })
    for (const [key, value] of Object.entries(env))
      if (value === undefined) delete childEnv[key]
      else childEnv[key] = value
    const run = await exec(process.execPath, [script], {
      cwd: this.root,
      env: childEnv,
      timeout: 60_000,
    })
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
    return { ...run, calls }
  }
}

const test = base.extend<{ scratch: Scratch }>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  scratch: async ({}, use) => {
    const scratch = new Scratch()
    await use(scratch)
    scratch.remove()
  },
})

vi.setConfig({ testTimeout: 60_000 })

// ---------------------------------------------------------------------------
// What GitHub answers

/** The PRs that would close the issue, as the GraphQL query sees them. */
const closedBy = (
  nodes: { number: number; state: string; headRefOid: string }[],
  totalCount = nodes.length,
) => ({
  [`issue:${ISSUE}`]: { closedByPullRequestsReferences: { totalCount, nodes } },
})

const openPr = (number: number, headRefOid = HEAD) => ({
  number,
  state: 'OPEN',
  headRefOid,
})

interface ListedRun {
  id: number
  status: string
  conclusion: string | null
  event?: string
}

/**
 * The issue-link runs for a head SHA, newest first, of any event: the fake
 * answers the listing as GitHub filters it by event.
 */
const runsFor = (sha: string, ...runs: ListedRun[]) => ({
  [`runs:${sha}`]: {
    total_count: runs.length,
    workflow_runs: runs.map((run) => ({
      event: 'pull_request_target',
      ...run,
      head_sha: sha,
    })),
  },
})

/** One run as GET actions/runs/{id} gives it. */
const runNow = (id: number, status: string, conclusion: string | null) => ({
  id,
  status,
  conclusion,
  head_sha: HEAD,
  event: 'pull_request_target',
})

const keys = (calls: Call[]): (string | undefined)[] =>
  calls.map((call) => call.key)

describe.concurrent('scripts/refresh-issue-link.mjs', () => {
  test('does nothing, and asks gh nothing, when the event is on a pull request', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({}, { IS_PR: 'true' })
    expect(run.status).toBe(0)
    expect(run.calls).toEqual([])
    expect(run.stdout).toContain('Nada a fazer')
  })

  test('does nothing when no PR closes the issue', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({ answers: closedBy([]) })
    expect(run.status, run.stdout).toBe(0)
    expect(keys(run.calls)).toEqual([`issue:${ISSUE}`])
    expect(run.stdout).toContain(
      `Nenhuma PR aberta fecha a #${ISSUE}: nada a re-rodar.`,
    )
  })

  test('re-runs the finished issue-link run of an open PR, by its id', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({
      answers: {
        ...closedBy([openPr(12)]),
        ...runsFor(HEAD, {
          id: 4242,
          status: 'completed',
          conclusion: 'success',
        }),
        'rerun:4242': true,
      },
    })
    expect(run.status, run.stdout).toBe(0)
    expect(keys(run.calls)).toEqual([
      `issue:${ISSUE}`,
      `runs:${HEAD}`,
      'rerun:4242',
    ])
    expect(run.calls[1].argv).toEqual([
      'api',
      `repos/${REPO}/actions/workflows/issue-link.yml/runs?head_sha=${HEAD}&event=pull_request_target&per_page=1`,
    ])
    expect(run.calls.at(-1)?.argv).toEqual([
      'api',
      '-X',
      'POST',
      `repos/${REPO}/actions/runs/4242/rerun`,
    ])
    expect(run.stdout).toContain(
      `PR #12 (${HEAD.slice(0, 7)}): run 4242 do issue-link re-executada`,
    )
  })

  test("re-runs the run from main, never a newer pull_request run of the PR's own copy", async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({
      answers: {
        ...closedBy([openPr(12)]),
        ...runsFor(
          HEAD,
          {
            id: 5001,
            status: 'completed',
            conclusion: 'success',
            event: 'pull_request',
          },
          { id: 4242, status: 'completed', conclusion: 'failure' },
        ),
        'rerun:4242': true,
      },
    })
    expect(run.status, run.stdout).toBe(0)
    expect(keys(run.calls)).toEqual([
      `issue:${ISSUE}`,
      `runs:${HEAD}`,
      'rerun:4242',
    ])
    expect(run.stdout).toContain(
      'run 4242 do issue-link re-executada (era failure)',
    )
  })

  test('reports no run when the head has only pull_request runs', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({
      answers: {
        ...closedBy([openPr(12)]),
        ...runsFor(HEAD, {
          id: 5001,
          status: 'completed',
          conclusion: 'success',
          event: 'pull_request',
        }),
      },
    })
    expect(run.status, run.stdout).toBe(0)
    expect(keys(run.calls)).toEqual([`issue:${ISSUE}`, `runs:${HEAD}`])
    expect(run.stdout).toContain(
      `nenhuma run do issue-link (${issueLinkEvent}) para este commit`,
    )
  })

  test('re-runs a cancelled run too: it holds no verdict at all', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({
      answers: {
        ...closedBy([openPr(12)]),
        ...runsFor(HEAD, {
          id: 4243,
          status: 'completed',
          conclusion: 'cancelled',
        }),
        'rerun:4243': true,
      },
    })
    expect(run.status, run.stdout).toBe(0)
    expect(keys(run.calls).at(-1)).toBe('rerun:4243')
  })

  test.for(['in_progress', 'queued'])(
    'waits for an unfinished run (%s) to finish, then re-runs it',
    async (status, { expect, scratch }) => {
      const run = await scratch.refresh({
        answers: {
          ...closedBy([openPr(12)]),
          ...runsFor(HEAD, { id: 4244, status, conclusion: null }),
          'rerun:4244': true,
        },
        sequences: {
          'run:4244': [
            runNow(4244, status, null),
            runNow(4244, 'completed', 'failure'),
          ],
        },
      })
      expect(run.status, run.stdout).toBe(0)
      expect(keys(run.calls)).toEqual([
        `issue:${ISSUE}`,
        `runs:${HEAD}`,
        'run:4244',
        'run:4244',
        'rerun:4244',
      ])
      expect(run.calls[2].argv).toEqual([
        'api',
        `repos/${REPO}/actions/runs/4244`,
      ])
      expect(run.stdout).toContain(
        `PR #12 (${HEAD.slice(0, 7)}): a run 4244 do issue-link está ${status}; esperando ela terminar`,
      )
      expect(run.stdout).toContain(
        `PR #12 (${HEAD.slice(0, 7)}): run 4244 do issue-link re-executada (era failure, depois de esperar ela terminar).`,
      )
    },
  )

  test("waits up to the contract's time when REFRESH_WAIT_MS is not set", async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh(
      {
        answers: {
          ...closedBy([openPr(12)]),
          ...runsFor(HEAD, {
            id: 4244,
            status: 'in_progress',
            conclusion: null,
          }),
          'run:4244': runNow(4244, 'completed', 'success'),
          'rerun:4244': true,
        },
      },
      { REFRESH_WAIT_MS: undefined },
    )
    expect(run.status, run.stdout).toBe(0)
    expect(run.stdout).toContain(
      `até ${(refreshWaitMs / 1000).toLocaleString('pt-BR')} s ao todo`,
    )
  })

  test("polls at the contract's interval when REFRESH_POLL_MS is not set", async ({
    expect,
    scratch,
  }) => {
    // A wait shorter than one interval: the one poll comes at the deadline.
    const run = await scratch.refresh(
      {
        answers: {
          ...closedBy([openPr(12)]),
          ...runsFor(HEAD, {
            id: 4244,
            status: 'in_progress',
            conclusion: null,
          }),
          'run:4244': runNow(4244, 'in_progress', null),
        },
      },
      { REFRESH_POLL_MS: undefined, REFRESH_WAIT_MS: '300' },
    )
    expect(run.status).toBe(1)
    expect(run.stdout).toContain(
      `com uma consulta a cada ${(refreshPollMs / 1000).toLocaleString('pt-BR')} s`,
    )
  })

  test('polls every REFRESH_POLL_MS', async ({ expect, scratch }) => {
    const run = await scratch.refresh(
      {
        answers: {
          ...closedBy([openPr(12)]),
          ...runsFor(HEAD, {
            id: 4244,
            status: 'in_progress',
            conclusion: null,
          }),
          'rerun:4244': true,
        },
        sequences: { 'run:4244': [runNow(4244, 'completed', 'success')] },
      },
      { REFRESH_POLL_MS: '700' },
    )
    expect(run.status, run.stdout).toBe(0)
    const [listing, poll] = run.calls.slice(1, 3)
    expect([listing.key, poll.key]).toEqual([`runs:${HEAD}`, 'run:4244'])
    expect(poll.at - listing.at).toBeGreaterThanOrEqual(700)
  })

  test('goes red, and re-runs nothing, when the run is still going at the deadline', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh(
      {
        answers: {
          ...closedBy([openPr(12)]),
          ...runsFor(HEAD, {
            id: 4244,
            status: 'in_progress',
            conclusion: null,
          }),
          'run:4244': runNow(4244, 'in_progress', null),
          'rerun:4244': true,
        },
      },
      { REFRESH_POLL_MS: '300', REFRESH_WAIT_MS: '2500' },
    )
    expect(run.status).toBe(1)
    const polls = keys(run.calls).filter((key) => key === 'run:4244')
    expect(polls.length).toBeGreaterThanOrEqual(1)
    expect(keys(run.calls)).not.toContain('rerun:4244')
    expect(run.stdout).toContain(
      'a run 4244 do issue-link ainda não terminou (in_progress) depois de 2,5 s de espera',
    )
    expect(run.stdout).toContain(
      `Re-rode quando terminar: gh run rerun 4244 --repo ${REPO}`,
    )
  })

  test('shares one deadline among the PRs, and still refreshes a finished one', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh(
      {
        answers: {
          ...closedBy([openPr(12), openPr(13, OTHER)]),
          ...runsFor(HEAD, { id: 4244, status: 'queued', conclusion: null }),
          'run:4244': runNow(4244, 'queued', null),
          ...runsFor(OTHER, {
            id: 4250,
            status: 'completed',
            conclusion: 'success',
          }),
          'rerun:4250': true,
        },
      },
      { REFRESH_WAIT_MS: '0' },
    )
    expect(run.status).toBe(1)
    // The deadline had passed: no poll at all, and the other PR's finished
    // run is re-run all the same.
    expect(keys(run.calls)).toEqual([
      `issue:${ISSUE}`,
      `runs:${HEAD}`,
      `runs:${OTHER}`,
      'rerun:4250',
    ])
    expect(run.stdout).toContain('a run 4244 do issue-link ainda não terminou')
  })

  test('goes red with the reason when a poll fails', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({
      answers: {
        ...closedBy([openPr(12)]),
        ...runsFor(HEAD, { id: 4244, status: 'in_progress', conclusion: null }),
      },
      fail: { 'run:4244': 'unreachable' },
    })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('Atualização interrompida')
    expect(run.stdout).toContain('no such host')
    expect(keys(run.calls).at(-1)).toBe('run:4244')
  })

  test('reports an open PR with no issue-link run for its head', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({
      answers: { ...closedBy([openPr(12)]), ...runsFor(HEAD) },
    })
    expect(run.status, run.stdout).toBe(0)
    expect(keys(run.calls)).toEqual([`issue:${ISSUE}`, `runs:${HEAD}`])
    expect(run.stdout).toContain(
      'nenhuma run do issue-link (pull_request_target) para este commit',
    )
  })

  test('ignores merged and closed PRs, which GitHub lists anyway', async ({
    expect,
    scratch,
  }) => {
    // includeClosedPrs: false still lists a merged PR (measured on #2).
    const run = await scratch.refresh({
      answers: {
        ...closedBy([
          { number: 10, state: 'MERGED', headRefOid: OTHER },
          { number: 11, state: 'CLOSED', headRefOid: OTHER },
          openPr(12),
        ]),
        ...runsFor(HEAD, {
          id: 4245,
          status: 'completed',
          conclusion: 'failure',
        }),
        'rerun:4245': true,
      },
    })
    expect(run.status, run.stdout).toBe(0)
    expect(keys(run.calls)).toEqual([
      `issue:${ISSUE}`,
      `runs:${HEAD}`,
      'rerun:4245',
    ])
    expect(run.stdout).toContain('PR #10 ignorada: está MERGED.')
    expect(run.stdout).toContain('PR #11 ignorada: está CLOSED.')
  })

  test('goes red when more PRs close the issue than one page holds', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({ answers: closedBy([], 11) })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('é fechada por 11 PRs e só 0 foram lidas')
  })

  test.for<[string, string, 'auth' | 'unreachable' | 'forbidden', string]>([
    ['reading the issue', `issue:${ISSUE}`, 'auth', 'Bad credentials'],
    ['listing the runs', `runs:${HEAD}`, 'unreachable', 'no such host'],
    [
      'the re-run',
      'rerun:4246',
      'forbidden',
      'Resource not accessible by integration',
    ],
  ])(
    'goes red with the reason when %s fails',
    async ([, key, mode, reason], { expect, scratch }) => {
      const run = await scratch.refresh({
        answers: {
          ...closedBy([openPr(12)]),
          ...runsFor(HEAD, {
            id: 4246,
            status: 'completed',
            conclusion: 'success',
          }),
          'rerun:4246': true,
        },
        fail: { [key]: mode },
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toContain(reason)
      expect(run.stdout).toContain('Atualização interrompida')
      expect(keys(run.calls).at(-1)).toBe(key)
    },
  )

  test('goes red when the issue does not exist', async ({
    expect,
    scratch,
  }) => {
    const run = await scratch.refresh({ answers: { [`issue:${ISSUE}`]: null } })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('Could not resolve to an Issue')
  })

  test.for<[string, Record<string, string | undefined>]>([
    ['ISSUE_NUMBER', { ISSUE_NUMBER: '05' }],
    ['ISSUE_NUMBER', { ISSUE_NUMBER: undefined }],
    ['IS_PR', { IS_PR: '' }],
    ['GITHUB_REPOSITORY', { GITHUB_REPOSITORY: undefined }],
    ['REFRESH_POLL_MS', { REFRESH_POLL_MS: '1s' }],
    ['REFRESH_WAIT_MS', { REFRESH_WAIT_MS: '-5' }],
  ])(
    'refuses a malformed %s with exit 2',
    async ([name, env], { expect, scratch }) => {
      const run = await scratch.refresh({}, env)
      expect(run.status).toBe(2)
      expect(run.stderr).toContain(name)
      expect(run.calls).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// The workflow

describe('.github/workflows/issue-link-refresh.yml', () => {
  const text = readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'issue-link-refresh.yml'),
    'utf8',
  )
  const runs = [...text.matchAll(/^\s+run:\s*(.+)$/gm)].map((m) => m[1])

  it('reacts to label, edit, closing, reopening and comment events on an issue', () => {
    expect(text).toMatch(/^name: Atualiza vínculo com issue$/m)
    expect(text).toMatch(
      /^on:\n {2}issues:\n {4}types: \[labeled, unlabeled, edited, closed, reopened\]\n {2}issue_comment:\n {4}types: \[created, edited, deleted\]\n\n/m,
    )
  })

  it('may re-run workflows and read, nothing more', () => {
    expect(text).toMatch(
      /^permissions:\n {2}actions: write\n {2}issues: read\n {2}pull-requests: read\n {2}contents: read\n\n/m,
    )
    // Only YAML keys count: the header comment may name a permission.
    expect(text.match(/^\s+[\w-]+:\s*write\s*$/gm)).toHaveLength(1)
  })

  it('refreshes one issue at a time without cancelling a running refresh', () => {
    expect(text).toMatch(
      /^concurrency:\n {2}group: issue-link-refresh-\$\{\{ github\.event\.issue\.number \}\}\n {2}cancel-in-progress: false\n/m,
    )
  })

  it('skips pull request comments before a runner starts', () => {
    expect(text).toMatch(
      /^ {4}if: \$\{\{ !github\.event\.issue\.pull_request \}\}$/m,
    )
  })

  it('is no required check', () => {
    expect(text).toMatch(/^ {2}refresh:\n {4}name: refresh$/m)
    expect(requiredChecks.map((check) => check.job)).not.toContain('refresh')
  })

  it('checks out only the scripts, keeps no credential, and pins every action', () => {
    expect(text).toMatch(/^ {10}sparse-checkout: scripts$/m)
    expect(text).toMatch(/^ {10}persist-credentials: false$/m)
    const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
    expect(uses).toHaveLength(2)
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/)
  })

  it('hands the event to the script through env, never inside run', () => {
    expect(runs).toEqual(['node scripts/refresh-issue-link.mjs'])
    for (const script of runs) expect(script).not.toContain('${{')
    for (const line of [
      'GH_TOKEN: ${{ github.token }}',
      'ISSUE_NUMBER: ${{ github.event.issue.number }}',
      'IS_PR: ${{ github.event.issue.pull_request != null }}',
    ])
      expect(text).toContain(`          ${line}\n`)
  })

  it('is named in the header of issue-link.yml, which its events do not reach', () => {
    const issueLink = readFileSync(
      path.join(projectRoot, '.github', 'workflows', issueLinkWorkflowFile),
      'utf8',
    )
    const header = issueLink.slice(0, issueLink.indexOf('\nname: '))
    expect(header).toContain('issue-link-refresh.yml re-runs this job')
    expect(header).not.toContain('After one of those, re-run this job')
  })

  it('waits for a run in progress inside the job: four minutes of five, polled every fifteen seconds', () => {
    expect(text).toMatch(/^ {4}timeout-minutes: 5$/m)
    expect(refreshWaitMs).toBe(240_000)
    expect(refreshPollMs).toBe(15_000)
    expect(refreshWaitMs).toBeLessThan(5 * 60_000)
  })

  it('re-runs the workflow of the required issue-link check', () => {
    const issueLink = readFileSync(
      path.join(projectRoot, '.github', 'workflows', issueLinkWorkflowFile),
      'utf8',
    )
    const workflow = /^name: (.+)$/m.exec(issueLink)?.[1]
    expect(requiredChecks).toContainEqual({ workflow, job: 'issue-link' })
  })
})
