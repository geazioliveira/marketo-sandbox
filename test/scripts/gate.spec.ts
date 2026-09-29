import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { test as base } from 'vitest'
import {
  branchShapes,
  bugSections,
  featureSections,
  gateCacheFile,
  gateCacheSchema,
  gateStatus,
  ownerRule,
  parseBranch,
  stepIds,
  type GateCache,
} from '../../scripts/loop-sections.mjs'
import {
  exec,
  type GateResult,
  type GhAnswer,
  type GhFixture,
  installGate,
  NAME,
  OWNER,
  TempRepo,
} from '../support/temp-repo'

/**
 * The loop gate, driven as a command: every case builds a repository of its
 * own, puts a strict fake gh first on PATH, and runs scripts/gate.mjs as a
 * child process, the way `npm run gate` and issue-link.yml run it. Nothing
 * here reads the real tracker: a case that depended on a live issue would fail
 * for reasons that have nothing to do with the gate.
 *
 * Each refusal has the passing control beside it, because a gate that refused
 * everything would pass every refusal case and be useless.
 *
 * The cases run concurrently: each spawns a few dozen processes, and on a
 * machine where every spawn is scanned that is minutes when run one by one.
 * So each case uses its own repositories (`fresh`), removed when that case
 * finishes, and the `expect` of its own context.
 */

const test = base.extend<{ fresh: () => Promise<TempRepo> }>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  fresh: async ({}, use) => {
    const made: TempRepo[] = []
    await use(async () => {
      const repo = await TempRepo.create()
      made.push(repo)
      return repo
    })
    for (const repo of made) repo.remove()
  },
})

vi.setConfig({ testTimeout: 120_000, maxConcurrency: 12 })

const ISSUE = 42
const BRANCH = 'feature/42-a-thing'
const PR = 7
const INTENT = 'context/intent/feature-a-thing.md'
const CHANGELOG = 'context/evolution/changelog.md'
const ENTRY = `## 2026-09-20: Uma coisa (#${ISSUE})`

// ---------------------------------------------------------------------------
// The issue, as GitHub's GraphQL API returns it

type Actor = { __typename: string; login: string }
interface Comment {
  body: string
  createdAt: string
  lastEditedAt: string | null
  author: Actor | null
}

const owner: Actor = { __typename: 'User', login: OWNER }
const at = (time: string): string => `2026-09-20T${time}:00Z`

/** A plan with one `##` section per required heading, in the contract's order. */
function planOf(
  required: readonly { heading: string }[],
  content: Record<string, string | null>,
): string {
  return required
    .map(({ heading }) => {
      const text =
        heading in content ? content[heading] : `Texto de ${heading}.`
      return text === null ? null : `## ${heading}\n\n${text}`
    })
    .filter((part): part is string => part !== null)
    .join('\n\n')
}

function featureBody(
  overrides: Record<string, string | null> = {},
  branch = BRANCH,
): string {
  const plan = planOf(featureSections, {
    'Critérios de aceite': '- [ ] O gate abre na branch certa.',
    Plano: `Branch: \`${branch}\`.\n\n1. Intent.\n2. Build e Learn.`,
    Riscos: 'NORMAL: só testes.',
    ...overrides,
  })
  return `## Issue mãe\n\n#1\n\n${plan}\n`
}

function bugBody(branch: string): string {
  return planOf(bugSections, {
    'Onde será corrigido': `Na branch \`${branch}\`.`,
    'Critérios de aceite': '- [ ] O teste falha antes e passa depois.',
    Riscos: 'NORMAL.',
  })
}

const comment = (
  body: string,
  createdAt: string,
  extra: Partial<Comment> = {},
): Comment => ({ body, createdAt, lastEditedAt: null, author: owner, ...extra })

const approve = (createdAt = at('12:00'), extra: Partial<Comment> = {}) =>
  comment('# Owner Approve\n\nAprovado, pode seguir.', createdAt, extra)

const labeled = (name: string, createdAt: string, actor: Actor = owner) => ({
  __typename: 'LabeledEvent',
  createdAt,
  actor,
  label: { name },
})

const reopened = (createdAt: string) => ({
  __typename: 'ReopenedEvent',
  createdAt,
})

const deleted = (createdAt: string) => ({
  __typename: 'CommentDeletedEvent',
  createdAt,
})

const defaultEvents = () => [
  labeled('enhancement', at('10:00')),
  labeled('ready-for-human', at('10:00')),
  labeled('ready-for-agent', at('12:05')),
]

interface IssueOptions {
  /** The issue's number; ISSUE unless a case names another (a stack's parent or slice). */
  number?: number
  /** The parent's number, when the issue is a sub-issue; null says it has none. */
  parent?: number | null
  /** The parent's repository; this one unless a case names another. */
  parentRepo?: string
  state?: 'OPEN' | 'CLOSED'
  body?: string
  lastEditedAt?: string | null
  labels?: string[]
  /** The labels' totalCount; defaults to their number, and null leaves it out. */
  labelsTotal?: number | null
  comments?: Comment[]
  events?: object[]
  commentsTotal?: number
  eventsTotal?: number
  /** A stack parent's sub-issues (#31): slices of this repository unless a case says otherwise. */
  subIssues?: SubIssue[]
  /** The sub-issues' totalCount; defaults to their number. */
  subIssuesTotal?: number
}

interface SubIssue {
  number: number
  /** OPEN unless the slice was merged (its PR closes it). */
  state?: 'OPEN' | 'CLOSED'
  repo?: string
  labels?: string[]
  labelsTotal?: number
}

function issueAnswer(options: IssueOptions = {}): GhAnswer {
  const comments = options.comments ?? [approve()]
  const events = options.events ?? defaultEvents()
  const labels = options.labels ?? ['enhancement', 'ready-for-agent']
  const labelsTotal =
    options.labelsTotal === undefined ? labels.length : options.labelsTotal
  const number = options.number ?? ISSUE
  return {
    number,
    mode: 'ok',
    data: {
      repository: {
        owner: { login: OWNER },
        issue: {
          number,
          ...(options.parent === undefined
            ? {}
            : {
                parent:
                  options.parent === null
                    ? null
                    : {
                        number: options.parent,
                        repository: {
                          nameWithOwner:
                            options.parentRepo ?? `${OWNER}/${NAME}`,
                        },
                      },
              }),
          state: options.state ?? 'OPEN',
          body: options.body ?? featureBody(),
          lastEditedAt: options.lastEditedAt ?? null,
          labels: {
            ...(labelsTotal === null ? {} : { totalCount: labelsTotal }),
            nodes: labels.map((name) => ({ name })),
          },
          comments: {
            totalCount: options.commentsTotal ?? comments.length,
            nodes: comments,
          },
          timelineItems: {
            totalCount: options.eventsTotal ?? events.length,
            nodes: events,
          },
          ...(options.subIssues === undefined
            ? {}
            : {
                subIssues: {
                  totalCount:
                    options.subIssuesTotal ?? options.subIssues.length,
                  nodes: options.subIssues.map((child) => {
                    const childLabels = child.labels ?? [
                      'enhancement',
                      'stack-slice',
                    ]
                    return {
                      number: child.number,
                      state: child.state ?? 'OPEN',
                      repository: {
                        nameWithOwner: child.repo ?? `${OWNER}/${NAME}`,
                      },
                      labels: {
                        totalCount: child.labelsTotal ?? childLabels.length,
                        nodes: childLabels.map((name) => ({ name })),
                      },
                    }
                  }),
                },
              }),
        },
      },
    },
  }
}

const closing = (number: number, nameWithOwner = `${OWNER}/${NAME}`) => ({
  number,
  repository: { nameWithOwner },
})

// Copilot as GitHub's GraphQL gives a review's author, written out here rather
// than read from the contract, so a change to the contract fails these cases.
const COPILOT = {
  __typename: 'Bot',
  login: 'copilot-pull-request-reviewer',
  databaseId: 175728472,
}
/** The command every copilot-review refusal gives, for PR 7. */
const REQUEST = `gh pr edit ${PR} --add-reviewer @copilot`
/** How every refusal of a review step ends: the gate in CI mode, for PR 7. */
const RENEW = `depois, renove o veredito na cabeça da PR com node scripts/gate.mjs --pr ${PR} --branch ${BRANCH}`
/** A commit the PR held before its head. */
const OLD = `abcdef1${'0'.repeat(33)}`

interface Review {
  state: string
  submittedAt: string | null
  commit: { oid: string } | null
  author: Record<string, unknown> | null
  body?: string | null
}

/** A review body as Copilot writes one when it reviewed. */
const REVIEWED =
  '## Pull request overview\n\nCopilot reviewed 2 out of 2 changed files in this pull request and generated 1 comment.'

// The bodies of two failed Copilot reviews, as GitHub gives them
// (keycloak/keycloak#52793 and Azure/azure-powershell#30106).
const ERRORED =
  'Copilot encountered an error and was unable to review this pull request. You can try again by re-requesting a review.'
const NO_FILES =
  "Copilot wasn't able to review any files in this pull request.\n\n\n\n"

/** A Copilot review of `oid`, COMMENTED, unless the case says otherwise. */
const review = (oid: string, extra: Partial<Review> = {}): Review => ({
  state: 'COMMENTED',
  submittedAt: at('13:00'),
  commit: { oid },
  author: COPILOT,
  body: REVIEWED,
  ...extra,
})

interface Thread {
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  comments: { nodes: { url: string; author: { login: string } }[] }
}

const threadUrl = (n: number) =>
  `https://github.com/${OWNER}/${NAME}/pull/${PR}#discussion_r${1000 + n}`

/** Review thread n, open, on line n of its own file, opened by Copilot. */
const thread = (
  n: number,
  extra: Partial<Thread> = {},
  login = COPILOT.login,
): Thread => ({
  isResolved: false,
  isOutdated: false,
  path: `src/file-${n}.ts`,
  line: n,
  comments: { nodes: [{ url: threadUrl(n), author: { login } }] },
  ...extra,
})

const connection = <T>(nodes: T[], totalCount: number = nodes.length) => ({
  totalCount,
  nodes,
})

/**
 * The PR as GitHub's GraphQL returns it. By default it is ready for a merge:
 * Copilot reviewed its head, no review is requested, and it has no review
 * thread.
 */
function prAnswer(
  headRefOid: string,
  overrides: Record<string, unknown> = {},
): GhAnswer {
  return {
    number: PR,
    mode: 'ok',
    data: {
      repository: {
        pullRequest: {
          baseRefName: 'main',
          headRefName: BRANCH,
          headRefOid,
          isDraft: false,
          body: `Closes #${ISSUE}.\n\n## Risco\n\nNORMAL.`,
          additions: 40,
          deletions: 10,
          changedFiles: 3,
          closingIssuesReferences: { totalCount: 1, nodes: [closing(ISSUE)] },
          reviews: connection([review(headRefOid)]),
          reviewRequests: connection([]),
          reviewThreads: connection([]),
          ...overrides,
        },
      },
    },
  }
}

const failing = (mode: GhAnswer['mode'], number = ISSUE): GhAnswer => ({
  number,
  mode,
})

// ---------------------------------------------------------------------------
// The repository

interface BranchOptions {
  branch?: string
  from?: string
  first?: Record<string, string>
  /** The changelog at HEAD; null leaves it as the start point had it. */
  learn?: string | null
  secondMessage?: string
  publish?: boolean
}

/**
 * A work branch: an intent-only first commit, then a build commit that adds
 * the changelog entry, every message citing the issue, published to origin.
 */
async function workBranch(
  repo: TempRepo,
  options: BranchOptions = {},
): Promise<string> {
  const branch = options.branch ?? BRANCH
  const number = parseBranch(branch)?.issue ?? ISSUE
  await repo.git('switch', '-q', '-c', branch, options.from ?? 'main')
  await repo.commit(
    options.first ?? { [INTENT]: '# Intent\n' },
    `Registra o intent (Refs #${number})`,
  )
  const learn =
    options.learn === undefined
      ? `# Changelog\n\n${ENTRY}\n\nO que mudou.\n`
      : options.learn
  await repo.commit(
    {
      'src/thing.ts': 'export const thing = 1\n',
      ...(learn === null ? {} : { [CHANGELOG]: learn }),
    },
    options.secondMessage ?? `Constrói e registra o Learn (Refs #${number})`,
  )
  if (options.publish ?? true) await repo.publish(branch)
  return repo.head()
}

type Fresh = () => Promise<TempRepo>

/** A repository on the standard work branch, and the gate run over it. */
async function local(
  fresh: Fresh,
  issue: IssueOptions | GhAnswer = {},
  branchOptions: BranchOptions = {},
  args: string[] = [],
) {
  const repo = await fresh()
  await workBranch(repo, branchOptions)
  const answer = 'mode' in issue ? issue : issueAnswer(issue)
  return {
    repo,
    ...(await repo.gateJson(args, { fixture: { issue: answer } })),
  }
}

/** The gate over a repository some case has already shaped. */
const judge = (repo: TempRepo, issue: IssueOptions = {}) =>
  repo.gateJson([], { fixture: { issue: issueAnswer(issue) } })

/**
 * A checkout the way actions/checkout leaves one for pull_request_target:
 * HEAD detached at the PR head, no local branches, every branch under
 * refs/remotes/origin. The gate runs from a trusted copy outside it.
 */
async function ci(
  fresh: Fresh,
  fixture: (head: string) => GhFixture,
  branchOptions: BranchOptions = {},
  env: Record<string, string> = {},
) {
  const repo = await fresh()
  await workBranch(repo, branchOptions)
  return ciOver(repo, fixture, { env })
}

/**
 * CI mode over a repository some case has already shaped, on `branch` (BRANCH
 * unless given). Only that branch and main are deleted locally, so a case
 * deletes any other local branch itself.
 */
async function ciOver(
  repo: TempRepo,
  fixture: (head: string) => GhFixture,
  {
    env = {},
    prepare,
    branch = BRANCH,
    pathOverride,
    args = [],
  }: {
    env?: Record<string, string>
    /** Runs on the trusted copy of the gate before it runs. */
    prepare?: (script: string) => void
    branch?: string
    /** A PATH in place of the usual one (pathWithFailingGit). */
    pathOverride?: string
    /** Arguments after --pr and --branch (the workflow's --review-report). */
    args?: string[]
  } = {},
) {
  const head = await repo.head()
  await repo.git('switch', '-q', '--detach')
  await repo.git('branch', '-q', '-D', branch)
  await repo.git('branch', '-q', '-D', 'main')
  const trusted = installGate(path.join(repo.root, 'trusted'))
  prepare?.(trusted)
  const run = await repo.gateJson(
    ['--pr', String(PR), '--branch', branch, ...args],
    {
      fixture: fixture(head),
      script: trusted,
      env: { GITHUB_REPOSITORY: `${OWNER}/${NAME}`, ...env },
      ...(pathOverride === undefined ? {} : { pathOverride }),
    },
  )
  return { repo, head, ...run }
}

/**
 * A PATH whose git fails with exit 128 when `failWhen`, a sh test on its
 * arguments, holds, and runs the real git for anything else: a git failure on
 * one kind of call only, the way a damaged object or a shallow history makes
 * one fail.
 */
async function pathWithFailingGit(
  repo: TempRepo,
  name: string,
  failWhen: string,
): Promise<string> {
  const which = await exec('sh', ['-c', 'command -v git'], {
    timeout: 60_000,
  })
  if (which.status !== 0)
    throw new Error(`command -v git falhou: ${which.stderr}`)
  const realGit = which.stdout.trim()
  const dir = path.join(repo.bin, '..', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'git'),
    `#!/bin/sh\nif ${failWhen}; then\n  echo "fatal: simulado" >&2\n  exit 128\nfi\nexec ${JSON.stringify(realGit)} "$@"\n`,
    { mode: 0o755 },
  )
  return [dir, repo.bin, process.env.PATH ?? ''].join(path.delimiter)
}

/** A git that cannot compare HEAD with one commit (`git merge-base <a> <sha>`). */
const pathFailingMergeBase = (repo: TempRepo, sha: string) =>
  pathWithFailingGit(
    repo,
    'git-sem-merge-base',
    `[ "$1" = merge-base ] && [ "$2" != --is-ancestor ] && [ "$3" = ${sha} ]`,
  )

/** A git that cannot walk a branch's first-parent line (`git rev-list --first-parent`). */
const pathFailingFirstParentWalk = (repo: TempRepo) =>
  pathWithFailingGit(
    repo,
    'git-sem-first-parent',
    '[ "$1" = rev-list ] && case " $* " in *" --first-parent "*) true ;; *) false ;; esac',
  )

/**
 * Rewrites one piece of a gate script, the way a careless edit would. Throws
 * when the piece is not there, so a reworded query fails the case loudly
 * instead of mutating nothing and passing.
 */
function mutate(script: string, from: string, to: string): void {
  const text = readFileSync(script, 'utf8')
  if (!text.includes(from)) throw new Error(`mutação sem alvo: ${from}`)
  writeFileSync(script, text.replace(from, to))
}

const passingCi = (head: string): GhFixture => ({
  issue: issueAnswer(),
  pr: prAnswer(head),
})

/** The gate over the standard work branch in either mode, with this issue. */
const inMode = (fresh: Fresh, mode: 'local' | 'CI', issue: IssueOptions) =>
  mode === 'local'
    ? local(fresh, issue)
    : ci(fresh, (head) => ({ issue: issueAnswer(issue), pr: prAnswer(head) }))

/** Labels that are neither a category nor a state, to fill an issue up. */
const fillerLabels = (count: number) =>
  Array.from({ length: count }, (_, i) => `area-${i + 1}`)

const step = (result: GateResult, id: string) => {
  const found = result.steps.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`passo ausente: ${id}`)
  return found
}

const statuses = (result: GateResult) =>
  Object.fromEntries(result.steps.map((entry) => [entry.id, entry.status]))

/** The steps only CI mode judges: the ones that read the PR. */
const ciOnly = new Set([
  'pr-base',
  'pr-closes',
  'pr-closes-only',
  'pr-first-line',
  'copilot-review',
  'review-threads',
  'pr-size',
])

const localPass = Object.fromEntries(
  stepIds.map((id) => [id, ciOnly.has(id) ? 'skip' : 'ok']),
)

const readCache = async (repo: TempRepo) =>
  JSON.parse(
    readFileSync(path.join(await repo.gitDir(), gateCacheFile), 'utf8'),
  ) as Record<string, unknown>

// Every group runs at once; vitest caps the cases in flight at maxConcurrency.
describe.concurrent('scripts/gate.mjs', () => {
  // ---------------------------------------------------------------------------
  // The control

  describe.concurrent('the passing control', () => {
    test('opens locally on an approved issue with every step ticked', async ({
      expect,
      fresh,
    }) => {
      const { status, result, calls, stdout } = await local(fresh)
      expect(statuses(result), JSON.stringify(result, null, 2)).toEqual(
        localPass,
      )
      expect(status).toBe(0)
      expect(result).toMatchObject({
        schema: gateCacheSchema,
        mode: 'local',
        repo: `${OWNER}/${NAME}`,
        branch: BRANCH,
        issue: ISSUE,
        open: true,
        verified: true,
        blocked: [],
      })
      // One question, about this issue, of this repository.
      expect(calls.map(({ kind, number }) => ({ kind, number }))).toEqual([
        { kind: 'issue', number: ISSUE },
      ])
      expect(stdout.startsWith('{')).toBe(true)
    })

    test('reports every step id, in the contract order', async ({
      expect,
      fresh,
    }) => {
      const { result } = await local(fresh)
      expect(result.steps.map((entry) => entry.id)).toEqual([...stepIds])
    })

    test('prints one line per step and ends with the owner rule', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      const { status, stdout } = await repo.gate([], {
        fixture: { issue: issueAnswer() },
      })
      expect(status).toBe(0)
      expect(stdout).toContain(
        `  [x] approve: Approve do dono em ${at('12:00')}`,
      )
      expect(stdout).toContain('  [-] pr-base: só no modo CI')
      expect(stdout).toContain(`O gate está aberto para a #${ISSUE}.`)
      const lines = stdout.trimEnd().split('\n')
      expect(lines.at(-1)).toBe(ownerRule)
      expect(
        lines.filter((line) => /^ {2}\[[x ?-]\] /.test(line)),
      ).toHaveLength(stepIds.length)
    })

    test('opens a fix/ branch on a bug exactly as a feature/ branch', async ({
      expect,
      fresh,
    }) => {
      const branch = 'fix/42-a-thing'
      const { status, result } = await local(
        fresh,
        { labels: ['bug', 'ready-for-agent'], body: bugBody(branch) },
        { branch },
      )
      expect(statuses(result), JSON.stringify(result, null, 2)).toEqual(
        localPass,
      )
      expect(status).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Where there is nothing to gate

  describe.concurrent('branches that name no issue', () => {
    test('on main, nothing is being built: exit 0, no gh call, a closed cache', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      const { status, result, calls, out } = await repo.gateJson()
      expect(status).toBe(0)
      expect(calls).toEqual([])
      expect(out).toContain('nada está sendo construído')
      expect(result).toMatchObject({ branch: 'main', issue: null, open: false })
      expect(step(result, 'up-to-date').status).toBe('ok')
      expect(result.steps.map((entry) => entry.id)).toEqual([...stepIds])
      expect(await readCache(repo)).toMatchObject({
        branch: 'main',
        open: false,
        verified: false,
      })
    })

    test('on main, warns when local main is ahead of origin/main', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.commit({ 'unpublished.md': 'x\n' }, 'Não publicado')
      await repo.commit({ 'unpublished.md': 'y\n' }, 'Também não publicado')
      const { status, result, out } = await repo.gateJson()
      expect(status).toBe(0)
      expect(step(result, 'up-to-date')).toMatchObject({
        status: 'no',
        blocks: false,
      })
      expect(step(result, 'up-to-date').detail).toContain(
        '2 commit(s) à frente',
      )
      expect(out).toContain('Aviso:')
    })

    test.for([
      'claude/x',
      'feature/02-x',
      'feature/1--x',
      'fix/42',
      'batch/2026-09-22',
      'Feature/42-a-thing',
    ])('refuses %s without calling gh', async (branch, { expect, fresh }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', branch, 'origin/main')
      const { status, result, calls, out } = await judge(repo)
      expect(status).toBe(1)
      expect(calls).toEqual([])
      expect(step(result, 'branch')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(result.open).toBe(false)
      expect(out).toContain(branchShapes)
      expect(out).toContain('não existe lane sem issue')
      expect(out.trimEnd().endsWith(ownerRule)).toBe(true)
    })

    test('refuses a detached HEAD without calling gh', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      await repo.git('switch', '-q', '--detach')
      const { status, calls, out } = await judge(repo)
      expect(status).toBe(1)
      expect(calls).toEqual([])
      expect(out).toContain('detached')
    })
  })

  // ---------------------------------------------------------------------------
  // The repository step

  describe.concurrent('repo', () => {
    test('blocks a gate run from another checkout than the one it judges', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      const elsewhere = installGate(path.join(repo.root, 'elsewhere'))
      const { status, result } = await repo.gateJson([], {
        fixture: { issue: issueAnswer() },
        script: elsewhere,
      })
      expect(status).toBe(1)
      expect(step(result, 'repo').status).toBe('no')
      expect(step(result, 'repo').detail).toContain('pertence a')
    })

    test('blocks when AGENTS.md is not at the top level', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      await repo.git('rm', '-q', 'AGENTS.md')
      await repo.git('commit', '-q', '-m', 'Remove o roteador (Refs #42)')
      await repo.publish(BRANCH)
      const { status, result } = await judge(repo)
      expect(status).toBe(1)
      expect(step(result, 'repo').detail).toContain('AGENTS.md')
    })

    test.for([
      `ssh://git@github.com/${OWNER}/${NAME}.git`,
      `ssh://git@github.com/${OWNER}/${NAME}`,
      `https://github.com/${OWNER}/${NAME}/`,
      `https://github.com/${OWNER}/${NAME}.git/`,
      `git@github.com:${OWNER}/${NAME}`,
    ])(
      'reads the repository from the origin %s',
      async (url, { expect, fresh }) => {
        const repo = await fresh()
        await workBranch(repo)
        await repo.git('remote', 'set-url', 'origin', url)
        const { status, result, calls } = await judge(repo)
        expect(step(result, 'repo').status).toBe('ok')
        expect(result.repo).toBe(`${OWNER}/${NAME}`)
        expect(calls.map(({ kind }) => kind)).toEqual(['issue'])
        expect(status).toBe(0)
      },
    )

    test('blocks, without asking GitHub, when origin is not a GitHub repository', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      await repo.git(
        'remote',
        'set-url',
        'origin',
        'https://gitlab.com/x/y.git',
      )
      const { status, result, calls } = await judge(repo)
      expect(status).toBe(1)
      expect(calls).toEqual([])
      expect(step(result, 'repo').status).toBe('no')
      expect(result.repo).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Reading the issue: missing, refused, unreachable

  describe.concurrent('gh failures', () => {
    test('blocks when the issue does not exist', async ({ expect, fresh }) => {
      const { status, result } = await local(fresh, failing('missing'))
      expect(status).toBe(1)
      expect(step(result, 'issue-open')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(step(result, 'issue-open').detail).toContain(
        `a #${ISSUE} não existe`,
      )
      expect(result.verified).toBe(false)
    })

    test('blocks when GitHub refuses the credential (HTTP 401)', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, failing('auth'))
      expect(status).toBe(1)
      expect(step(result, 'issue-open').status).toBe('no')
      expect(step(result, 'issue-open').detail).toContain('Bad credentials')
      expect(result.verified).toBe(false)
    })

    test('blocks when gh is not installed', async ({ expect, fresh }) => {
      const repo = await fresh()
      await workBranch(repo)
      // A PATH holding git and nothing else, so no gh, fake or real, is found.
      const which = await exec('sh', ['-c', 'command -v git'], {
        timeout: 60_000,
      })
      if (which.status !== 0)
        throw new Error(`command -v git falhou: ${which.stderr}`)
      const onlyGit = path.join(repo.root, 'only-git')
      mkdirSync(onlyGit)
      symlinkSync(which.stdout.trim(), path.join(onlyGit, 'git'))
      const { status, result } = await repo.gateJson([], {
        fixture: { issue: issueAnswer() },
        pathOverride: onlyGit,
      })
      expect(status).toBe(1)
      expect(step(result, 'issue-open').status).toBe('no')
      expect(step(result, 'issue-open').detail).toContain(
        'gh não está instalado',
      )
    })

    test('degrades to unchecked locally when GitHub is unreachable', async ({
      expect,
      fresh,
    }) => {
      const { repo, status, result, out } = await local(
        fresh,
        failing('unreachable'),
      )
      expect(status).toBe(0)
      for (const id of [
        'issue-open',
        'kind',
        'state-label',
        'sections',
        'criteria',
        'approve',
      ])
        expect(step(result, id).status, id).toBe('unchecked')
      expect(result).toMatchObject({ open: true, verified: false, blocked: [] })
      expect(out).toContain('no such host')
      expect(out).toContain('[?] approve')
      // The steps read from git still report.
      expect(step(result, 'intent-first').status).toBe('ok')
      expect((await readCache(repo)).verified).toBe(false)
    })

    test('blocks in CI when GitHub is unreachable (fail-closed)', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ci(fresh, (head) => ({
        issue: failing('unreachable'),
        pr: prAnswer(head),
      }))
      expect(status).toBe(1)
      expect(result.blocked).toEqual(
        expect.arrayContaining(['issue-open', 'approve', 'sections']),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // The issue's labels and plan

  describe.concurrent('issue steps', () => {
    test('blocks a closed issue', async ({ expect, fresh }) => {
      const { status, result } = await local(fresh, { state: 'CLOSED' })
      expect(status).toBe(1)
      expect(step(result, 'issue-open').detail).toContain('fechada')
    })

    test('blocks an issue with no category label', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        labels: ['ready-for-agent'],
      })
      expect(status).toBe(1)
      expect(step(result, 'kind').status).toBe('no')
    })

    test('blocks an issue with two category labels', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        labels: ['bug', 'enhancement', 'ready-for-agent'],
      })
      expect(status).toBe(1)
      expect(step(result, 'kind').detail).toContain('bug, enhancement')
    })

    test('blocks two state labels even when one is ready-for-agent (lite-campaign #103)', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        labels: ['enhancement', 'ready-for-human', 'ready-for-agent'],
      })
      expect(status).toBe(1)
      expect(step(result, 'state-label').status).toBe('no')
      expect(step(result, 'state-label').detail).toContain(
        'ready-for-human, ready-for-agent',
      )
    })

    test('blocks ready-for-human alone', async ({ expect, fresh }) => {
      const { status, result } = await local(fresh, {
        labels: ['enhancement', 'ready-for-human'],
      })
      expect(status).toBe(1)
      expect(step(result, 'state-label').detail).toContain('ready-for-human')
    })

    test('blocks no state label at all', async ({ expect, fresh }) => {
      const { status, result } = await local(fresh, { labels: ['enhancement'] })
      expect(status).toBe(1)
      expect(step(result, 'state-label').status).toBe('no')
    })

    // GitHub gives the gate one page of 100 labels. The 101st, needs-triage
    // here, contradicts ready-for-agent, and a gate that judged the page it
    // read as the whole list would open.
    test.for(['local', 'CI'] as const)(
      'blocks kind and state-label when the issue has more labels than the gate read (%s)',
      async (mode, { expect, fresh }) => {
        const labels = [
          'enhancement',
          'ready-for-agent',
          ...fillerLabels(98),
          'needs-triage',
        ]
        const { status, result } = await inMode(fresh, mode, { labels })
        for (const id of ['kind', 'state-label'])
          expect(step(result, id)).toMatchObject({
            status: 'no',
            blocks: true,
            detail: expect.stringContaining(
              'a issue tem 101 labels e o gate leu 100: 1 ficou sem ler',
            ),
          })
        expect(step(result, 'kind').detail).toContain('não julga a categoria')
        expect(step(result, 'state-label').detail).toContain(
          'não julga o estado',
        )
        expect(result.blocked).toEqual(['kind', 'state-label'])
        expect(status).toBe(1)
      },
    )

    test.for(['local', 'CI'] as const)(
      'judges exactly 100 labels, one page, as the whole list (%s)',
      async (mode, { expect, fresh }) => {
        const labels = ['enhancement', 'ready-for-agent', ...fillerLabels(98)]
        const { status, result } = await inMode(fresh, mode, { labels })
        expect(step(result, 'kind')).toMatchObject({
          status: 'ok',
          detail: 'enhancement',
        })
        expect(step(result, 'state-label')).toMatchObject({
          status: 'ok',
          detail: 'ready-for-agent',
        })
        expect(result.blocked).toEqual([])
        expect(status).toBe(0)
      },
    )

    test('blocks kind and state-label when GitHub does not say how many labels there are', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, { labelsTotal: null })
      expect(step(result, 'kind')).toMatchObject({ status: 'no', blocks: true })
      expect(step(result, 'state-label').detail).toContain(
        'o GitHub não disse quantas labels a issue tem',
      )
      expect(status).toBe(1)
    })

    test('does not tick a fix/ branch’s category from a partial page of labels', async ({
      expect,
      fresh,
    }) => {
      const branch = 'fix/42-a-thing'
      const { status, result } = await local(
        fresh,
        {
          labels: [
            'bug',
            'ready-for-agent',
            ...fillerLabels(98),
            'enhancement',
          ],
          body: bugBody(branch),
        },
        { branch },
      )
      expect(step(result, 'branch')).toMatchObject({
        status: 'unchecked',
        detail: 'fix/ exige a label bug, e as labels não foram lidas',
      })
      expect(step(result, 'kind').status).toBe('no')
      expect(status).toBe(1)
    })

    test('blocks a missing section, names it and says why it exists', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      const { status, stdout } = await repo.gate([], {
        fixture: {
          issue: issueAnswer({ body: featureBody({ Riscos: null }) }),
        },
      })
      expect(status).toBe(1)
      expect(stdout).toContain('[ ] sections: faltam "Riscos"')
      const why = featureSections.find(
        ({ heading }) => heading === 'Riscos',
      )?.why
      expect(stdout).toContain(`Riscos: ${why}`)
      expect(stdout).toContain(`Build BLOQUEADO na #${ISSUE}:`)
    })

    test('blocks a section a form left as _No response_', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({ 'Estado atual': '_No response_' }),
      })
      expect(status).toBe(1)
      expect(step(result, 'sections').detail).toContain('vazias "Estado atual"')
    })

    test('blocks acceptance criteria with no checklist item', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({ 'Critérios de aceite': 'Tudo precisa funcionar.' }),
      })
      expect(status).toBe(1)
      expect(step(result, 'criteria').status).toBe('no')
      expect(step(result, 'sections').status).toBe('ok')
    })

    // The rendered issue shows no box in either: one is sample code, the
    // other a note GitHub hides.
    test.for([
      ['fenced code', 'Um exemplo:\n\n```md\n- [ ] O gate abre.\n```'],
      ['an HTML comment', 'A preencher.\n\n<!--\n- [ ] O gate abre.\n-->'],
    ] as const)(
      'blocks acceptance criteria whose only checklist is inside %s',
      async ([, criteria], { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          body: featureBody({ 'Critérios de aceite': criteria }),
        })
        expect(step(result, 'criteria').status).toBe('no')
        expect(step(result, 'sections').status).toBe('ok')
        expect(status).toBe(1)
      },
    )

    // A code example indented under a list item is still fenced code: GitHub
    // shows no box in it (#12).
    test.for([
      [
        'a numbered item',
        '1. Exemplo:\n\n    ```md\n    - [ ] O gate abre.\n    ```',
      ],
      ['a bullet', '- Exemplo:\n\n    ```md\n    - [ ] O gate abre.\n    ```'],
    ] as const)(
      'blocks acceptance criteria whose only checklist is fenced code under %s',
      async ([, criteria], { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          body: featureBody({ 'Critérios de aceite': criteria }),
        })
        expect(step(result, 'criteria')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'sections').status).toBe('ok')
        expect(status).toBe(1)
      },
    )

    // GitHub shows a section that holds only an HTML comment as empty. Before
    // #12 the comment's text made it a written section, and the gate opened.
    test.for(['local', 'CI'] as const)(
      'blocks a required section that holds only an HTML comment (%s)',
      async (mode, { expect, fresh }) => {
        const { status, result } = await inMode(fresh, mode, {
          body: featureBody({ Riscos: '<!-- HIGH ou NORMAL -->' }),
        })
        expect(step(result, 'sections')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'sections').detail).toContain('vazias "Riscos"')
        expect(result.blocked).toContain('sections')
        expect(status).toBe(1)
      },
    )

    // GitHub shows neither the heading nor the box of a commented-out
    // section. Before #12 the heading still made a section, whose content
    // began below the `<!--`, so the box counted and the gate opened.
    test.for(['local', 'CI'] as const)(
      'blocks a plan whose only acceptance criteria are commented out (%s)',
      async (mode, { expect, fresh }) => {
        const body = featureBody({
          'Estado atual':
            'Texto do estado.\n\n<!--\n## Critérios de aceite\n\n- [ ] O gate abre.\n-->',
          'Critérios de aceite': null,
        })
        const { status, result } = await inMode(fresh, mode, { body })
        expect(step(result, 'sections')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'sections').detail).toContain('Critérios de aceite')
        expect(step(result, 'criteria')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(result.blocked).toEqual(
          expect.arrayContaining(['sections', 'criteria']),
        )
        expect(status).toBe(1)
      },
    )

    test('reads the plan in force from the latest "# Plano" comment', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: 'O plano está no comentário abaixo.',
        comments: [
          comment(`# Plano\n\n${featureBody()}`, at('11:00')),
          approve(),
        ],
      })
      expect(status).toBe(0)
      expect(step(result, 'sections').detail).toContain('comentário "# Plano"')
      expect(step(result, 'branch-in-plan').status).toBe('ok')
    })

    test('judges the comment plan, not the body, once a "# Plano" exists', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody(),
        comments: [
          comment(`# Plano\n\n${featureBody({ Riscos: null })}`, at('11:00')),
          approve(),
        ],
      })
      expect(status).toBe(1)
      expect(step(result, 'sections').detail).toContain('faltam "Riscos"')
    })

    test('does not take a "## Plano" comment for a plan revision', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        comments: [comment('## Plano\n\nSó uma nota.', at('11:00')), approve()],
      })
      expect(status).toBe(0)
      expect(step(result, 'sections').detail).toContain('corpo da issue')
    })

    test('does not take "# Plano de testes" after the Approve for a plan revision', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        comments: [
          approve(),
          comment('# Plano de testes\n\nRodar a suíte inteira.', at('12:10')),
        ],
      })
      expect(status).toBe(0)
      expect(step(result, 'approve').status).toBe('ok')
      expect(step(result, 'sections').detail).toContain('corpo da issue')
    })

    test('blocks a plan that does not cite the branch', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({ Plano: '1. Fazer.' }),
      })
      expect(status).toBe(1)
      expect(step(result, 'branch-in-plan').status).toBe('no')
    })

    test('does not take a longer branch name for this one', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({ Plano: `Branch: \`${BRANCH}-v2\`.` }),
      })
      expect(status).toBe(1)
      expect(step(result, 'branch-in-plan').status).toBe('no')
    })

    // git takes feature/42-a-thing.old for another branch.
    test('does not take a dotted suffix of this branch for this one', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({ Plano: `Branch: ${BRANCH}.old, e só ela.` }),
      })
      expect(step(result, 'branch-in-plan').status).toBe('no')
      expect(status).toBe(1)
    })

    test('takes this branch at the end of a sentence, before its period', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({ Plano: `A branch é ${BRANCH}.\n\n1. Intent.` }),
      })
      expect(step(result, 'branch-in-plan').status).toBe('ok')
      expect(status).toBe(0)
    })

    test('reads the branch from "## Plano", not from a "## Plano de testes" before it', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({
          'Critérios de aceite':
            '- [ ] O gate abre na branch certa.\n\n## Plano de testes\n\nTestes de unidade.',
        }),
      })
      expect(step(result, 'branch-in-plan').status).toBe('ok')
      expect(status).toBe(0)
    })

    // The branch-in-plan step reads Plano as GitHub shows it (#12): a name
    // inside an HTML comment is not shown, a name in fenced code is.
    test.for([
      ['a comment block', `<!--\nBranch: \`${BRANCH}\`.\n-->\n\n1. Intent.`],
      ['an inline comment', `1. Intent. <!-- branch ${BRANCH} -->`],
    ] as const)(
      'blocks a plan that cites the branch only inside %s',
      async ([, plano], { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          body: featureBody({ Plano: plano }),
        })
        expect(step(result, 'branch-in-plan')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(status).toBe(1)
      },
    )

    test('takes the branch cited in fenced code inside Plano', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({
          Plano: `1. Cortar a branch:\n\n\`\`\`sh\ngit switch -c ${BRANCH} origin/main\n\`\`\`\n\n2. Build e Learn.`,
        }),
      })
      expect(step(result, 'branch-in-plan').status).toBe('ok')
      expect(status).toBe(0)
    })

    test('blocks a branch named in the plan only outside its Plano section', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        body: featureBody({
          'Estado atual': `A branch \`${BRANCH}\` ainda não existe.`,
          Plano: '1. Intent.\n2. Build e Learn.',
        }),
      })
      expect(status).toBe(1)
      expect(step(result, 'branch-in-plan').status).toBe('no')
      expect(step(result, 'branch-in-plan').detail).toContain('seção Plano')
    })

    test('reads a bug plan’s branch from "Onde será corrigido", not from elsewhere', async ({
      expect,
      fresh,
    }) => {
      const branch = 'fix/42-a-thing'
      const body = planOf(bugSections, {
        'Causa raiz': `Vista ao investigar na \`${branch}\`.`,
        'Onde será corrigido': 'Em src/thing.ts.',
        'Critérios de aceite': '- [ ] O teste falha antes e passa depois.',
        Riscos: 'NORMAL.',
      })
      const { status, result } = await local(
        fresh,
        { labels: ['bug', 'ready-for-agent'], body },
        { branch },
      )
      expect(status).toBe(1)
      expect(step(result, 'branch-in-plan').detail).toContain(
        'seção Onde será corrigido',
      )
    })

    test('blocks a fix/ branch on an enhancement', async ({
      expect,
      fresh,
    }) => {
      const branch = 'fix/42-a-thing'
      const { status, result } = await local(
        fresh,
        { body: featureBody({}, branch) },
        { branch },
      )
      expect(status).toBe(1)
      expect(step(result, 'branch').detail).toContain('fix/ exige a label bug')
    })

    test('reports the plan size without blocking on it', async ({
      expect,
      fresh,
    }) => {
      const { result } = await local(fresh)
      expect(step(result, 'size')).toMatchObject({
        status: 'ok',
        blocks: false,
      })
      expect(step(result, 'size').detail).toMatch(/^\d+ caracteres/)
    })
  })

  // ---------------------------------------------------------------------------
  // The Approve

  describe.concurrent('approve', () => {
    test('blocks when an Approve is withdrawn with text below the heading', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        comments: [
          approve(),
          comment('# Approve retirado\n\nPreciso rever o risco.', at('12:30')),
        ],
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain('retirado')
    })

    test.for([
      '# Owner Approve retirado',
      '## Owner Approve',
      '#Owner Approve',
      '#### OWNER APPROVE',
      '# Owner Approve: sim',
    ])(
      'does not read %j as an Approve, and says why',
      async (line, { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          comments: [comment(`${line}\n\nPode seguir.`, at('12:00'))],
        })
        expect(status).toBe(1)
        expect(step(result, 'approve').detail).toContain(`"${line}"`)
        expect(step(result, 'approve').detail).toContain(
          'não conta como Approve',
        )
      },
    )

    test.for([
      '# Approve retirado.',
      '# Approve retirado: rever riscos',
      '# Owner Approve retirado',
      '# Retiro o Approve',
      '## Approve retirado',
      '# approve retirado',
      '## Owner Approve',
    ])(
      'takes %j after an Approve as cancelling it',
      async (line, { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          comments: [
            approve(),
            comment(`${line}\n\nPreciso rever.`, at('12:30')),
          ],
        })
        expect(status).toBe(1)
        expect(step(result, 'approve').status).toBe('no')
        expect(step(result, 'approve').detail).toContain(`"${line}"`)
        expect(step(result, 'approve').detail).toContain('cancela')
      },
    )

    test.for([
      '##### Approve retirado',
      '###### Approve retirado',
      '**Approve retirado**',
      '> # Approve retirado',
      'Approve retirado\n===',
      'Approve retirado\n---',
    ])(
      'takes the heading-like opening %j after an Approve as cancelling it',
      async (opening, { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          comments: [
            approve(),
            comment(`${opening}\n\nPreciso rever.`, at('12:30')),
          ],
        })
        expect(status).toBe(1)
        expect(step(result, 'approve').detail).toContain('cancela')
      },
    )

    test.for([
      '#5 aguarda o Approve desta',
      'Approve retirado',
      'Sobre o Approve: tudo certo.',
    ])(
      'does not take the prose or issue reference %j after an Approve as cancelling it',
      async (opening, { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          comments: [approve(), comment(`${opening}\n\nx`, at('12:30'))],
        })
        expect(step(result, 'approve').status).toBe('ok')
        expect(status).toBe(0)
      },
    )

    test('blocks when ready-for-agent was applied before the Approve', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        events: [
          labeled('enhancement', at('10:00')),
          labeled('ready-for-agent', at('11:00')),
        ],
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain('antes do Approve')
    })

    test('needs ready-for-agent applied again after a withdrawal and a new Approve', async ({
      expect,
      fresh,
    }) => {
      const comments = [
        approve(at('11:00')),
        comment('# Approve retirado\n\nRevendo.', at('11:30')),
        approve(at('12:00')),
      ]
      const stale = await local(fresh, {
        comments,
        events: [
          labeled('enhancement', at('10:00')),
          labeled('ready-for-agent', at('11:05')),
        ],
      })
      expect(stale.status).toBe(1)
      expect(step(stale.result, 'approve').detail).toContain('antes do Approve')
      const again = await local(fresh, {
        comments,
        events: [
          labeled('enhancement', at('10:00')),
          labeled('ready-for-agent', at('11:05')),
          labeled('ready-for-agent', at('12:05')),
        ],
      })
      expect(again.status).toBe(0)
    })

    test('blocks an Approve without the owner’s words', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        comments: [comment('# Owner Approve', at('12:00'))],
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain('palavras do dono')
    })

    test('blocks an Approve written by a bot', async ({ expect, fresh }) => {
      const { status, result } = await local(fresh, {
        comments: [
          approve(at('12:00'), {
            author: { __typename: 'Bot', login: 'github-actions' },
          }),
        ],
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain('(Bot)')
    })

    test('blocks when ready-for-agent was applied by someone else', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        events: [
          labeled('enhancement', at('10:00')),
          labeled('ready-for-agent', at('12:05'), {
            __typename: 'User',
            login: 'someone-else',
          }),
        ],
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain('someone-else')
    })

    test('blocks when the body was edited after the Approve (lastEditedAt)', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        lastEditedAt: at('12:30'),
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain(
        'corpo da issue foi editado',
      )
    })

    test('does not block on a body edit before the Approve', async ({
      expect,
      fresh,
    }) => {
      const { status } = await local(fresh, { lastEditedAt: at('11:30') })
      expect(status).toBe(0)
    })

    test.for([
      ['a "# Plano" comment', `# Plano\n\n${featureBody()}`],
      // An approved "# Plano" edited so its heading is gone: the plan in force
      // falls back to the body, and nothing else would notice.
      [
        'a plan comment that lost its heading',
        `Plano antigo.\n\n${featureBody()}`,
      ],
      ['a plain comment', 'Uma resposta que mudou depois.'],
    ] as const)(
      'blocks when %s older than the Approve was edited after it',
      async ([, body], { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          comments: [
            comment(body, at('11:00'), { lastEditedAt: at('12:30') }),
            approve(),
          ],
        })
        expect(status).toBe(1)
        expect(step(result, 'approve').detail).toContain(
          `o comentário de ${at('11:00')} foi editado depois do Approve`,
        )
      },
    )

    test('does not block when the Approve itself was edited after the label', async ({
      expect,
      fresh,
    }) => {
      // The shape of #2: Approve, label, then the owner edits the Approve.
      const { status, result } = await local(fresh, {
        comments: [approve(at('12:00'), { lastEditedAt: at('12:30') })],
      })
      expect(status).toBe(0)
      expect(step(result, 'approve').status).toBe('ok')
    })

    test.for([
      // Posted, the withdrawal cancels the Approve; edited away, only its
      // edit time is left to show it, and the old Approve must not come back.
      ['a withdrawal edited away', 'Tudo certo, pode seguir.'],
      ['a revision edited away', `Plano antigo.\n\n${featureBody()}`],
      ['an answer', 'Respostas corrigidas.'],
    ] as const)(
      'blocks when a comment newer than the Approve is edited after it: %s',
      async ([, body], { expect, fresh }) => {
        const { status, result } = await local(fresh, {
          comments: [
            approve(),
            comment(body, at('12:10'), { lastEditedAt: at('12:30') }),
          ],
        })
        expect(status).toBe(1)
        expect(step(result, 'approve').detail).toContain(
          `o comentário de ${at('12:10')} foi editado depois do Approve`,
        )
      },
    )

    test('opens on the shape #2 has: the Approve edited, then an answer never edited', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        comments: [
          comment('# Owner Approve\n\nPode seguir.', '2026-09-24T22:08:39Z', {
            lastEditedAt: '2026-09-24T22:09:49Z',
          }),
          comment(
            '# Respondendo as perguntas:\n\n1. Sim.',
            '2026-09-24T22:09:58Z',
          ),
        ],
        events: [
          labeled('enhancement', '2026-09-24T22:00:00Z'),
          labeled('ready-for-agent', '2026-09-24T22:08:53Z'),
        ],
      })
      expect(step(result, 'approve').status).toBe('ok')
      expect(status).toBe(0)
    })

    test('blocks when a comment was deleted after the Approve', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        events: [...defaultEvents(), deleted(at('12:30'))],
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain('apagado')
    })

    test('does not block on a comment deleted before the Approve', async ({
      expect,
      fresh,
    }) => {
      const { status } = await local(fresh, {
        events: [deleted(at('11:00')), ...defaultEvents()],
      })
      expect(status).toBe(0)
    })

    test('blocks when a "# Plano" is posted after the Approve', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        comments: [
          approve(),
          comment(`# Plano\n\n${featureBody()}`, at('12:10')),
        ],
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain(
        'depois do último Approve',
      )
    })

    test('blocks when the issue was reopened after the Approve', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(fresh, {
        events: [...defaultEvents(), reopened(at('13:00'))],
      })
      expect(status).toBe(1)
      expect(step(result, 'approve').detail).toContain('reabertura')
    })

    test.for([
      ['comments', { commentsTotal: 101 }],
      ['label, reopen and deletion events', { eventsTotal: 101 }],
    ] as const)(
      'refuses to judge more than 100 %s',
      async ([, options], { expect, fresh }) => {
        const { status, result } = await local(fresh, options)
        expect(status).toBe(1)
        expect(step(result, 'approve').detail).toContain('não julga o Approve')
      },
    )
  })

  // ---------------------------------------------------------------------------
  // History: stacked, intent-first, learn

  describe.concurrent('stacked (lite-campaign #122)', () => {
    test('blocks a branch cut from another issue’s unmerged branch, and reads its own first commit', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'feature/41-other')
      await repo.commit(
        { 'context/intent/feature-other.md': '# Outro\n' },
        'Intent (Refs #41)',
      )
      await repo.commit({ 'src/other.ts': 'x\n' }, 'Build (Refs #41)')
      await workBranch(repo, {
        from: 'feature/41-other',
        first: { 'src/thing.ts': 'x\n' },
      })
      const { status, result } = await judge(repo)
      expect(status).toBe(1)
      expect(step(result, 'stacked').status).toBe('no')
      expect(step(result, 'stacked').detail).toContain('feature/41-other')
      // The branch below starts with an intent commit; this one does not.
      expect(step(result, 'intent-first').status).toBe('no')
      expect(step(result, 'intent-first').detail).toContain('src/thing.ts')
    })

    test('reads its own intent commit, not the first commit of the branch below', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'feature/41-other')
      await repo.commit({ 'src/other.ts': 'x\n' }, 'Build (Refs #41)')
      await workBranch(repo, { from: 'feature/41-other' })
      const { result } = await judge(repo)
      expect(step(result, 'stacked').status).toBe('no')
      expect(step(result, 'intent-first').status).toBe('ok')
    })

    test('blocks a branch cut from claude/foo with unmerged commits', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'claude/foo')
      await repo.commit({ 'notes.md': 'wip\n' }, 'wip')
      await workBranch(repo, { from: 'claude/foo' })
      const { status, result } = await judge(repo)
      expect(status).toBe(1)
      expect(step(result, 'stacked').detail).toContain('claude/foo')
    })

    test('ignores a claude/* ref that holds nothing origin/main lacks', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('branch', 'claude/foo', 'main')
      await workBranch(repo)
      const { status, result } = await judge(repo)
      expect(status).toBe(0)
      expect(step(result, 'stacked').status).toBe('ok')
    })

    test('blocks a branch cut from a local main that is ahead of origin/main', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.commit({ 'unpublished.md': 'x\n' }, 'Não publicado')
      await workBranch(repo)
      const { status, result } = await judge(repo)
      expect(status).toBe(1)
      expect(step(result, 'stacked').detail).toMatch(/com main\b/)
    })

    test('does not block a branch cut from origin/main while local main is ahead', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.commit({ 'unpublished.md': 'x\n' }, 'Não publicado')
      await workBranch(repo, { from: 'origin/main' })
      const { status, result } = await judge(repo)
      expect(status).toBe(0)
      expect(step(result, 'stacked').status).toBe('ok')
    })

    // The docs say to run the gate right after the cut, before the first
    // commit: that is when a start point that is not origin/main must show.
    test('blocks right after the cut from a local main that is ahead of origin/main', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.commit({ 'unpublished.md': 'x\n' }, 'Não publicado')
      await repo.git('switch', '-q', '-c', BRANCH, 'main')
      const { status, result } = await judge(repo)
      expect(status).toBe(1)
      expect(step(result, 'stacked').status).toBe('no')
      expect(step(result, 'stacked').detail).toMatch(/com main\b/)
    })

    test('blocks right after the cut from claude/foo with a wip commit', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'claude/foo')
      await repo.commit({ 'notes.md': 'wip\n' }, 'wip')
      await repo.git('switch', '-q', '-c', BRANCH, 'claude/foo')
      const { status, result } = await judge(repo)
      expect(status).toBe(1)
      expect(step(result, 'stacked').detail).toContain('claude/foo')
    })

    test('blocks right after the cut from another issue’s branch, which is at HEAD and not ahead', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'feature/41-other')
      await repo.commit({ 'src/other.ts': 'x\n' }, 'Build (Refs #41)')
      await repo.git('switch', '-q', '-c', BRANCH, 'feature/41-other')
      const { status, result } = await judge(repo)
      expect(status).toBe(1)
      expect(step(result, 'stacked').detail).toContain('feature/41-other')
    })

    // Right after the cut, the branch it was cut from moves on: it now
    // contains HEAD and is ahead of it, as a branch built on top of this one
    // would be, but HEAD has no commit citing #42 yet.
    test.for([
      ['the local branch', false],
      ['its published copy', true],
    ] as const)(
      'blocks right after the cut from another issue’s branch once %s moves ahead',
      async ([, published], { expect, fresh }) => {
        const repo = await fresh()
        await repo.git('switch', '-q', '-c', 'feature/41-other')
        await repo.commit(
          { 'context/intent/feature-other.md': '# Outro\n' },
          'Intent (Refs #41)',
        )
        await repo.commit({ 'src/other.ts': 'x\n' }, 'Build (Refs #41)')
        await repo.git('switch', '-q', '-c', BRANCH)
        await repo.git('switch', '-q', 'feature/41-other')
        await repo.commit({ 'src/more.ts': 'x\n' }, 'Mais (Refs #41)')
        if (published) {
          await repo.publish('feature/41-other')
          await repo.git('switch', '-q', BRANCH)
          await repo.git('branch', '-q', '-D', 'feature/41-other')
        } else await repo.git('switch', '-q', BRANCH)
        const { status, result } = await judge(repo)
        expect(step(result, 'stacked').status).toBe('no')
        expect(step(result, 'stacked').detail).toContain('feature/41-other')
        expect(status).toBe(1)
      },
    )

    test('hides no stacking behind a merge whose side branch is gone', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'side')
      await repo.commit({ 'src/side.ts': 'x\n' }, 'Código de fora')
      await repo.git('switch', '-q', '-c', BRANCH, 'main')
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      await repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge side (Refs #42)',
        'side',
      )
      const merge = (await repo.head()).slice(0, 7)
      await repo.git('branch', '-q', '-D', 'side')
      await repo.commit(
        { [CHANGELOG]: `# Changelog\n\n${ENTRY}\n` },
        'Learn (Refs #42)',
      )
      await repo.publish(BRANCH)
      const { status, result } = await judge(repo)
      expect(step(result, 'stacked').status).toBe('no')
      expect(step(result, 'stacked').detail).toContain(
        `um merge traz commits de fora de origin/main: ${merge}`,
      )
      // Every other step passes: only stacked sees the merged side branch.
      expect(result.blocked).toEqual(['stacked'])
      expect(status).toBe(1)
    })

    // 43 was cut from 41 and got its own commits; then 41 merged 43 back and
    // was published. 41 now contains HEAD and is ahead of it, like a branch
    // built on top of this one, but HEAD still carries 41's commits below the
    // cut. One commit citing #42 must not be enough to exempt 41.
    test('blocks a branch whose source merged it back, in both modes', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'feature/41-other')
      await repo.commit(
        { 'context/intent/feature-other.md': '# Outro\n' },
        'Intent (Refs #41)',
      )
      await repo.commit({ 'src/other.ts': 'x\n' }, 'Build (Refs #41)')
      await repo.git('switch', '-q', '-c', BRANCH)
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      await repo.commit(
        { [CHANGELOG]: `# Changelog\n\n${ENTRY}\n` },
        'Learn (Refs #42)',
      )
      await repo.publish(BRANCH)
      await repo.git('switch', '-q', 'feature/41-other')
      await repo.git('merge', '-q', '--no-ff', '-m', 'Merge 42', BRANCH)
      await repo.publish('feature/41-other')
      await repo.git('switch', '-q', BRANCH)

      const local = await judge(repo)
      expect(step(local.result, 'stacked').status).toBe('no')
      expect(step(local.result, 'stacked').detail).toContain('feature/41-other')
      expect(local.status).toBe(1)

      const ci = await ciOver(repo, passingCi)
      expect(step(ci.result, 'stacked').status).toBe('no')
      expect(ci.status).toBe(1)
    })

    // `git merge-base` exits 1 when two histories share no commit, and 128
    // when it cannot compare them. Only the first says the ref shares nothing.
    test('refuses a ref git cannot compare with HEAD, and takes one with no common commit as unrelated', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'feature/41-other', 'main')
      await repo.commit({ 'src/other.ts': 'x\n' }, 'Build (Refs #41)')
      await repo.publish('feature/41-other')
      const other = await repo.git('rev-parse', 'feature/41-other')
      await repo.git('switch', '-q', '--orphan', 'feature/46-orfa')
      await repo.commit({ 'orfa.txt': 'x\n' }, 'Outra história (Refs #46)')
      await repo.publish('feature/46-orfa')
      await repo.git('switch', '-q', '-c', BRANCH, 'main')
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      const unrelated = await judge(repo)
      expect(step(unrelated.result, 'stacked')).toMatchObject({ status: 'ok' })
      const failing = await repo.gateJson([], {
        fixture: { issue: issueAnswer() },
        pathOverride: await pathFailingMergeBase(repo, other),
      })
      expect(step(failing.result, 'stacked')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(step(failing.result, 'stacked').detail).toContain(
        'o git não conseguiu comparar feature/41-other, origin/feature/41-other com o HEAD',
      )
      expect(failing.result.open).toBe(false)
    })

    test('names a rebase when the merge brought in this branch’s own published copy', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', BRANCH, 'main')
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      // The published copy moved on (a suggestion applied on GitHub) while the
      // local branch got its own commit; `git pull` then made a merge commit.
      await repo.git('switch', '-q', '-c', 'remote-copy')
      await repo.commit({ 'src/suggested.ts': 'x\n' }, 'Sugestão (Refs #42)')
      await repo.publish(BRANCH)
      await repo.git('switch', '-q', BRANCH)
      await repo.git('branch', '-q', '-D', 'remote-copy')
      await repo.commit({ 'src/local.ts': 'x\n' }, 'Build (Refs #42)')
      await repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge origin copy (Refs #42)',
        `origin/${BRANCH}`,
      )
      const { status, result } = await judge(repo)
      expect(step(result, 'stacked').status).toBe('no')
      expect(step(result, 'stacked').detail).toContain('git pull --rebase')
      expect(step(result, 'stacked').detail).not.toContain('corte a branch')
      expect(status).toBe(1)
    })

    // Once the branch is published, origin/<branch> holds the merge itself,
    // and every parent of every merge is its ancestor: ancestry no longer
    // tells the own copy from another branch the push published along (#32).
    const expectRecut = (result: GateResult) => {
      expect(step(result, 'stacked').status).toBe('no')
      expect(step(result, 'stacked').detail).toContain(
        'corte a branch de origin/main atualizado',
      )
      expect(step(result, 'stacked').detail).not.toContain('cópia publicada')
      expect(step(result, 'stacked').detail).not.toContain('git pull --rebase')
    }

    test('names the recut for a published merge of another branch, in both modes', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'feature/41-other', 'main')
      await repo.commit({ 'src/other.ts': 'x\n' }, 'Build (Refs #41)')
      await repo.git('switch', '-q', '-c', BRANCH, 'main')
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      await repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge other (Refs #42)',
        'feature/41-other',
      )
      await repo.git('branch', '-q', '-D', 'feature/41-other')
      await repo.commit(
        { [CHANGELOG]: `# Changelog\n\n${ENTRY}\n` },
        'Learn (Refs #42)',
      )
      await repo.publish(BRANCH)
      const local = await judge(repo)
      expectRecut(local.result)
      expect(local.status).toBe(1)
      const ci = await ciOver(repo, passingCi)
      expectRecut(ci.result)
      expect(ci.status).toBe(1)
    })

    test('names the recut, not the own copy, once a merge of the own copy is published, in both modes', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', BRANCH, 'main')
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      await repo.git('switch', '-q', '-c', 'remote-copy')
      await repo.commit({ 'src/suggested.ts': 'x\n' }, 'Sugestão (Refs #42)')
      await repo.publish(BRANCH)
      await repo.git('switch', '-q', BRANCH)
      await repo.git('branch', '-q', '-D', 'remote-copy')
      await repo.commit({ 'src/local.ts': 'x\n' }, 'Build (Refs #42)')
      await repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge origin copy (Refs #42)',
        `origin/${BRANCH}`,
      )
      await repo.publish(BRANCH)
      const local = await judge(repo)
      expectRecut(local.result)
      expect(local.status).toBe(1)
      const ci = await ciOver(repo, passingCi)
      expectRecut(ci.result)
      expect(ci.status).toBe(1)
    })

    test('opens right after the cut from origin/main', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('branch', 'claude/foo', 'main')
      await repo.git('switch', '-q', '-c', BRANCH, 'origin/main')
      const { status, result } = await judge(repo)
      expect(status).toBe(0)
      expect(step(result, 'stacked').status).toBe('ok')
      expect(step(result, 'intent-first')).toMatchObject({
        status: 'no',
        blocks: false,
      })
    })

    test.for([
      ['with a commit of its own', true],
      ['with no commit of its own', false],
    ] as const)(
      'does not block this branch on a stale branch cut from it %s',
      async ([, ownCommit], { expect, fresh }) => {
        const repo = await fresh()
        await workBranch(repo)
        await repo.git('switch', '-q', '-c', 'feature/43-next')
        if (ownCommit)
          await repo.commit({ 'src/next.ts': 'x\n' }, 'Próxima (Refs #43)')
        await repo.publish('feature/43-next')
        await repo.git('switch', '-q', BRANCH)
        await repo.commit({ 'src/more.ts': 'x\n' }, 'Mais (Refs #42)')
        await repo.publish(BRANCH)
        const { status, result } = await judge(repo)
        expect(step(result, 'stacked').status).toBe('ok')
        // Its own intent commit, not the one after the shared part.
        expect(step(result, 'intent-first')).toMatchObject({
          status: 'ok',
          detail: expect.stringContaining('toca só context/intent/'),
        })
        expect(status).toBe(0)
      },
    )

    test('does not count a branch built on top of this one', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      await repo.git('switch', '-q', '-c', 'feature/43-next')
      await repo.commit({ 'src/next.ts': 'x\n' }, 'Próxima (Refs #43)')
      await repo.git('switch', '-q', BRANCH)
      const { status, result } = await judge(repo)
      expect(status).toBe(0)
      expect(step(result, 'stacked').status).toBe('ok')
    })

    // One issue, one branch (ADR 0001). Every commit on both sides cites #42,
    // so git cannot tell which branch was cut from which, and neither
    // exemption may apply: before #12, feature/42-lower's intent commit and
    // changelog entry ticked intent-first and learn for this branch.
    const lower = 'feature/42-lower'
    const sameIssueDetail = 'outra branch da #42'
    // The remedy depends on the direction (#12): a branch HEAD contains is
    // deleted with -d, which refuses unmerged work; one holding commits HEAD
    // lacks is merged into a single branch first. -D is never suggested.
    // The delete names only the commands for the refs found: -d for a local
    // branch, a push --delete (and the prune, should GitHub no longer have
    // it) for a copy on origin.
    const prune = 'se ela já não existe no GitHub, com git fetch --prune origin'
    const deleteIt = (name: string, refs: 'both' | 'local' | 'origin') =>
      ({
        both: `apague a outra branch da #42 com git branch -d ${name} e com git push origin --delete ${name} (${prune})`,
        local: `apague a outra branch da #42 com git branch -d ${name}`,
        origin: `apague a outra branch da #42 com git push origin --delete ${name} (${prune})`,
      })[refs]
    const keepOne = (name: string) =>
      `a outra branch da #42, ${name}, tem commits que esta não tem: fique com uma só, traga para ela o trabalho da outra, e só então apague a outra (git branch -d recusa apagar trabalho não mergeado)`

    test('blocks a branch cut from another branch of the same issue, in both modes', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo, { branch: lower })
      await repo.git('switch', '-q', '-c', BRANCH)
      await repo.commit({ 'src/b.ts': 'x\n' }, 'Outra parte (Refs #42)')
      await repo.publish(BRANCH)

      const local = await judge(repo)
      expect(step(local.result, 'stacked')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(step(local.result, 'stacked').detail).toContain(
        `${sameIssueDetail} (${lower}, origin/${lower})`,
      )
      // HEAD holds everything the lower branch holds: deleting it is safe.
      expect(step(local.result, 'stacked').detail).toContain(
        deleteIt(lower, 'both'),
      )
      expect(step(local.result, 'stacked').detail).not.toContain('tem commits')
      expect(step(local.result, 'stacked').detail).not.toContain('-D')
      expect(step(local.result, 'stacked').detail).not.toContain(
        'corte a branch',
      )
      expect(local.status).toBe(1)

      // CI sees only published branches.
      await repo.git('branch', '-q', '-D', lower)
      const ci = await ciOver(repo, passingCi)
      expect(step(ci.result, 'stacked').detail).toContain(
        `${sameIssueDetail} (origin/${lower})`,
      )
      // Only the copy on origin is there: no git branch -d for it.
      expect(step(ci.result, 'stacked').detail).toContain(
        deleteIt(lower, 'origin'),
      )
      expect(step(ci.result, 'stacked').detail).not.toContain('git branch -d')
      expect(ci.result.blocked).toContain('stacked')
      expect(ci.status).toBe(1)
    })

    // A branch of #42 that was never published has no copy on origin to
    // delete: the remedy names git branch -d alone, and following it opens
    // the gate.
    test('names only git branch -d for an unpublished branch of the same issue', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo, { branch: lower, publish: false })
      await repo.git('switch', '-q', '-c', BRANCH)
      await repo.commit({ 'src/b.ts': 'x\n' }, 'Outra parte (Refs #42)')
      await repo.publish(BRANCH)

      const local = await judge(repo)
      expect(step(local.result, 'stacked').detail).toContain(
        `${sameIssueDetail} (${lower})`,
      )
      expect(step(local.result, 'stacked').detail).toContain(
        deleteIt(lower, 'local'),
      )
      expect(step(local.result, 'stacked').detail).not.toContain(
        'git push origin --delete',
      )
      expect(step(local.result, 'stacked').detail).not.toContain('--prune')
      expect(local.status).toBe(1)

      await repo.git('branch', '-q', '-d', lower)
      const after = await judge(repo)
      expect(step(after.result, 'stacked').status).toBe('ok')
    })

    test('blocks the branch another branch of the same issue was cut from, in both modes', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo, { branch: lower })
      await repo.git('switch', '-q', '-c', BRANCH)
      await repo.commit({ 'src/b.ts': 'x\n' }, 'Outra parte (Refs #42)')
      await repo.publish(BRANCH)
      await repo.git('switch', '-q', lower)
      const issue = { body: featureBody({}, lower) }

      const local = await judge(repo, issue)
      expect(step(local.result, 'stacked').status).toBe('no')
      expect(step(local.result, 'stacked').detail).toContain(
        `${sameIssueDetail} (${BRANCH}, origin/${BRANCH})`,
      )
      // The other branch holds src/b.ts, which HEAD lacks: never "delete it".
      expect(step(local.result, 'stacked').detail).toContain(keepOne(BRANCH))
      expect(step(local.result, 'stacked').detail).not.toContain(
        'apague a outra branch',
      )
      expect(step(local.result, 'stacked').detail).not.toContain('-D')
      expect(local.status).toBe(1)

      await repo.git('branch', '-q', '-D', BRANCH)
      const ci = await ciOver(
        repo,
        (head) => ({
          issue: issueAnswer(issue),
          pr: prAnswer(head, { headRefName: lower }),
        }),
        { branch: lower },
      )
      expect(step(ci.result, 'stacked').detail).toContain(
        `${sameIssueDetail} (origin/${BRANCH})`,
      )
      expect(step(ci.result, 'stacked').detail).toContain(keepOne(BRANCH))
      expect(step(ci.result, 'stacked').detail).not.toContain(
        'apague a outra branch',
      )
      expect(ci.result.blocked).toContain('stacked')
      expect(ci.status).toBe(1)
    })

    // Owner's answer 1 on #12: a leftover under an old name blocks too. Its
    // commits all cite #42, so exemption (b) alone would let it through.
    test('blocks on a leftover of the same issue under an old name, in both modes', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      const old = 'feature/42-old'
      await workBranch(repo, { branch: old })
      await repo.git('branch', '-q', '-m', BRANCH)
      await repo.commit({ 'src/more.ts': 'x\n' }, 'Mais (Refs #42)')
      await repo.publish(BRANCH)

      const local = await judge(repo)
      expect(step(local.result, 'stacked').status).toBe('no')
      expect(step(local.result, 'stacked').detail).toContain(
        `${sameIssueDetail} (origin/${old})`,
      )
      // After git branch -m, the old name is on origin alone: the remedy
      // names no git branch -d, which would fail with "branch not found".
      // Deleted or renamed on GitHub and never pruned here, the tracking ref
      // outlives the branch: git push --delete fails on it, and a prune clears
      // it.
      expect(step(local.result, 'stacked').detail).toContain(
        deleteIt(old, 'origin'),
      )
      expect(step(local.result, 'stacked').detail).not.toContain(
        'git branch -d',
      )
      expect(local.result.blocked).toEqual(['stacked'])
      expect(local.status).toBe(1)

      const ci = await ciOver(repo, passingCi)
      expect(step(ci.result, 'stacked').detail).toContain(
        `${sameIssueDetail} (origin/${old})`,
      )
      expect(ci.result.blocked).toContain('stacked')
      expect(ci.status).toBe(1)
    })

    // Owner's decision on #12: only refs/heads/<branch> and
    // refs/remotes/origin/<branch> are this branch. The same name under
    // another remote is someone else's copy, and its commits citing #42 must
    // not tick exemption (b) for it either.
    test('exempts only this branch and its copy on origin: the same name under another remote blocks, in both modes', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      // Origin's copy left behind by a new commit.
      await repo.commit({ 'src/more.ts': 'x\n' }, 'Mais (Refs #42)')

      const own = await judge(repo)
      expect(step(own.result, 'stacked').status).toBe('ok')
      expect(step(own.result, 'pushed').status).toBe('no')
      expect(own.status).toBe(0)

      await repo.git('update-ref', `refs/remotes/upstream/${BRANCH}`, 'HEAD~1')
      const local = await judge(repo)
      expect(step(local.result, 'stacked')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(step(local.result, 'stacked').detail).toContain(
        `não tem com upstream/${BRANCH}`,
      )
      expect(step(local.result, 'stacked').detail).toContain('corte a branch')
      expect(step(local.result, 'stacked').detail).not.toContain(
        sameIssueDetail,
      )
      expect(local.result.blocked).toEqual(['stacked'])
      expect(local.status).toBe(1)

      await repo.publish(BRANCH)
      const ci = await ciOver(repo, passingCi)
      expect(step(ci.result, 'stacked').detail).toContain(
        `não tem com upstream/${BRANCH}`,
      )
      expect(ci.result.blocked).toContain('stacked')
      expect(ci.status).toBe(1)
    })

    test('blocks when there is no origin/main to compare with', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      await repo.git('update-ref', '-d', 'refs/remotes/origin/main')
      const { status, result } = await judge(repo)
      expect(status).toBe(1)
      expect(step(result, 'stacked').detail).toContain('git fetch origin')
    })
  })

  describe.concurrent('intent-first', () => {
    test('reports, without blocking locally, a first commit that touches code', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(
        fresh,
        {},
        { first: { 'src/thing.ts': 'x\n' } },
      )
      expect(status).toBe(0)
      expect(step(result, 'intent-first')).toMatchObject({
        status: 'no',
        blocks: false,
      })
    })

    test('does not accept a first commit that mixes intent and code', async ({
      expect,
      fresh,
    }) => {
      const { result } = await local(
        fresh,
        {},
        { first: { [INTENT]: '# Intent\n', 'src/thing.ts': 'x\n' } },
      )
      expect(step(result, 'intent-first').status).toBe('no')
    })

    test('skips merge commits and the upstream commits they bring', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      // origin/main moves on and is merged into the branch.
      await repo.git('switch', '-q', 'main')
      await repo.commit({ 'upstream.md': 'x\n' }, 'Upstream')
      await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      await repo.git('switch', '-q', BRANCH)
      await repo.git(
        'merge',
        '-q',
        '--no-edit',
        '-m',
        'Merge main (Refs #42)',
        'main',
      )
      await repo.publish(BRANCH)
      const { status, result } = await judge(repo)
      expect(step(result, 'intent-first').status).toBe('ok')
      expect(step(result, 'up-to-date').status).toBe('ok')
      expect(step(result, 'learn').status).toBe('ok')
      expect(status).toBe(0)
    })
  })

  describe.concurrent('intent-first in CI', () => {
    test('accepts an intent file with a non-ASCII name', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ci(fresh, passingCi, {
        first: { 'context/intent/feature-criação.md': '# Intent\n' },
      })
      expect(step(result, 'intent-first').status).toBe('ok')
      expect(status).toBe(0)
    })

    test('refuses a merge that brings code in before the intent', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('switch', '-q', '-c', 'side')
      await repo.commit({ 'src/side.ts': 'x\n' }, 'Código de fora')
      await repo.git('switch', '-q', '-c', BRANCH, 'main')
      await repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge side (Refs #42)',
        'side',
      )
      await repo.git('branch', '-q', '-D', 'side')
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      await repo.commit(
        { [CHANGELOG]: `# Changelog\n\n${ENTRY}\n` },
        'Learn (Refs #42)',
      )
      const { status, result } = await ciOver(repo, passingCi)
      expect(step(result, 'stacked')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(step(result, 'stacked').detail).toContain(
        'um merge traz commits de fora de origin/main',
      )
      expect(step(result, 'intent-first')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(step(result, 'intent-first').detail).toContain(
        'merge com conteúdo próprio antes do intent',
      )
      expect(status).toBe(1)
    })

    test('refuses a merge of origin/main amended with code before the intent', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('branch', '-q', BRANCH, 'main')
      await repo.commit({ 'upstream.md': 'x\n' }, 'Upstream')
      await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      await repo.git('switch', '-q', BRANCH)
      await repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge origin/main (Refs #42)',
        'origin/main',
      )
      // An evil merge: both parents are in origin/main, the code is not.
      repo.write({ 'src/x.ts': 'x\n' })
      await repo.git('add', '-A')
      await repo.git('commit', '-q', '--amend', '--no-edit')
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      await repo.commit(
        { [CHANGELOG]: `# Changelog\n\n${ENTRY}\n` },
        'Learn (Refs #42)',
      )
      const { status, result } = await ciOver(repo, passingCi)
      expect(step(result, 'stacked').status).toBe('ok')
      expect(step(result, 'intent-first')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(step(result, 'intent-first').detail).toContain(
        'merge com conteúdo próprio antes do intent',
      )
      expect(status).toBe(1)
    })

    // `-s ours` keeps the old base's tree: the merge's tree equals a parent in
    // origin/main, yet merging the PR would silently drop what main gained.
    test('refuses a merge -s ours of origin/main before the intent', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('branch', '-q', BRANCH, 'main')
      await repo.commit({ 'src/fix.ts': 'x\n' }, 'Upstream fix')
      await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      await repo.git('switch', '-q', BRANCH)
      await repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-s',
        'ours',
        '-m',
        'Merge origin/main (Refs #42)',
        'origin/main',
      )
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      await repo.commit(
        { [CHANGELOG]: `# Changelog\n\n${ENTRY}\n` },
        'Learn (Refs #42)',
      )
      const { status, result } = await ciOver(repo, passingCi)
      expect(step(result, 'intent-first')).toMatchObject({
        status: 'no',
        blocks: true,
      })
      expect(step(result, 'intent-first').detail).toContain(
        'merge com conteúdo próprio antes do intent',
      )
      expect(status).toBe(1)
    })

    test('allows merging origin/main in before the intent', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await repo.git('branch', '-q', BRANCH, 'main')
      await repo.commit({ 'upstream.md': 'x\n' }, 'Upstream')
      await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      await repo.git('switch', '-q', BRANCH)
      await repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge origin/main (Refs #42)',
        'origin/main',
      )
      await repo.commit({ [INTENT]: '# Intent\n' }, 'Intent (Refs #42)')
      await repo.commit(
        { [CHANGELOG]: `# Changelog\n\n${ENTRY}\n` },
        'Learn (Refs #42)',
      )
      const { status, result } = await ciOver(repo, passingCi)
      expect(step(result, 'intent-first').status).toBe('ok')
      expect(status).toBe(0)
    })
  })

  describe.concurrent('learn (lite-campaign #124)', () => {
    test('does not count a mention of #N outside an entry heading', async ({
      expect,
      fresh,
    }) => {
      const { result } = await local(
        fresh,
        {},
        {
          learn: `# Changelog\n\n## 2026-09-20: Outra coisa (#41)\n\nMenciona #${ISSUE} no texto.\n\n## Notas sobre #${ISSUE}\n`,
        },
      )
      expect(step(result, 'learn').status).toBe('no')
    })

    test('does not count a heading that already existed at the merge-base', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      const withEntry = `# Changelog\n\n${ENTRY}\n\nDe antes.\n`
      await repo.commit({ [CHANGELOG]: withEntry }, 'Entrada antiga')
      await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      await workBranch(repo, { learn: withEntry })
      const { result } = await judge(repo)
      expect(step(result, 'learn').status).toBe('no')
      expect(step(result, 'learn').detail).toContain('já existia no merge-base')
    })

    test('accepts a heading with the PR number appended', async ({
      expect,
      fresh,
    }) => {
      const { result } = await local(
        fresh,
        {},
        {
          learn: `# Changelog\n\n## 2026-09-20: Uma coisa (#${ISSUE}, PR #${PR})\n`,
        },
      )
      expect(step(result, 'learn').status).toBe('ok')
    })

    test('reports a missing changelog', async ({ expect, fresh }) => {
      const repo = await fresh()
      await repo.git('rm', '-q', CHANGELOG)
      await repo.git('commit', '-q', '-m', 'Sem changelog')
      await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      await workBranch(repo, { learn: null })
      const { status, result } = await judge(repo)
      expect(status).toBe(0)
      expect(step(result, 'learn')).toMatchObject({
        status: 'no',
        blocks: false,
      })
      expect(step(result, 'learn').detail).toContain('não existe em HEAD')
    })
  })

  // ---------------------------------------------------------------------------
  // Report-only local steps

  describe.concurrent('report-only steps', () => {
    test('reports a commit that does not cite the issue, without blocking', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(
        fresh,
        {},
        { secondMessage: 'Constrói sem citar' },
      )
      expect(status).toBe(0)
      expect(step(result, 'commits-cite-issue').status).toBe('no')
      expect(step(result, 'commits-cite-issue').detail).toContain(
        'Constrói sem citar',
      )
    })

    test('reads a commit message holding byte 0x1E without crashing', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await local(
        fresh,
        {},
        { secondMessage: 'Constrói\x1ecom separador (Refs #42)' },
      )
      expect(status).toBe(0)
      expect(step(result, 'commits-cite-issue').status).toBe('ok')
      expect(step(result, 'intent-first').status).toBe('ok')
    })

    test('does not take #420 for #42', async ({ expect, fresh }) => {
      const { result } = await local(
        fresh,
        {},
        { secondMessage: 'Constrói (Refs #420)' },
      )
      expect(step(result, 'commits-cite-issue').status).toBe('no')
    })

    test('reports an uncommitted change and an unpublished branch', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo, { publish: false })
      repo.write({ 'scratch.md': 'x\n' })
      const { status, result } = await judge(repo)
      expect(status).toBe(0)
      expect(step(result, 'worktree-clean').status).toBe('no')
      expect(step(result, 'pushed').detail).toContain('ainda não foi publicada')
    })

    test('reports a published branch that is behind HEAD', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      await repo.commit({ 'src/more.ts': 'x\n' }, 'Mais (Refs #42)')
      const { result } = await judge(repo)
      expect(step(result, 'pushed').status).toBe('no')
    })

    test('reports a branch whose base is behind origin/main', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      await repo.git('switch', '-q', 'main')
      await repo.commit({ 'upstream.md': 'x\n' }, 'Upstream')
      await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      await repo.git('switch', '-q', BRANCH)
      const { status, result } = await judge(repo)
      expect(status).toBe(0)
      expect(step(result, 'up-to-date')).toMatchObject({
        status: 'no',
        blocks: false,
      })
    })
  })

  // ---------------------------------------------------------------------------
  // CI mode

  describe.concurrent('CI mode', () => {
    test('opens on a PR that closes exactly its issue, and writes no cache', async ({
      expect,
      fresh,
    }) => {
      const { status, result, calls, repo } = await ci(fresh, passingCi)
      const expected = Object.fromEntries(
        stepIds.map((id) => [
          id,
          id === 'worktree-clean' || id === 'pushed' ? 'skip' : 'ok',
        ]),
      )
      expect(statuses(result), JSON.stringify(result, null, 2)).toEqual(
        expected,
      )
      expect(status).toBe(0)
      expect(result.mode).toBe('ci')
      expect(calls.map(({ kind, number }) => ({ kind, number }))).toEqual([
        { kind: 'issue', number: ISSUE },
        { kind: 'pr', number: PR },
      ])
      expect(existsSync(path.join(await repo.gitDir(), gateCacheFile))).toBe(
        false,
      )
    })

    test('blocks a PR that does not target main', async ({ expect, fresh }) => {
      const { status, result } = await ci(fresh, (head) => ({
        issue: issueAnswer(),
        pr: prAnswer(head, { baseRefName: 'develop' }),
      }))
      expect(status).toBe(1)
      expect(step(result, 'pr-base').status).toBe('no')
    })

    test('blocks a PR linked (sidebar-style) to another issue only', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ci(fresh, (head) => ({
        issue: issueAnswer(),
        pr: prAnswer(head, {
          closingIssuesReferences: { totalCount: 1, nodes: [closing(41)] },
        }),
      }))
      expect(status).toBe(1)
      expect(step(result, 'pr-closes').status).toBe('no')
      expect(step(result, 'pr-closes').detail).toContain('#41')
      expect(step(result, 'pr-closes-only').status).toBe('ok')
    })

    test('does not take #N of another repository for this issue', async ({
      expect,
      fresh,
    }) => {
      const { result } = await ci(fresh, (head) => ({
        issue: issueAnswer(),
        pr: prAnswer(head, {
          closingIssuesReferences: {
            totalCount: 1,
            nodes: [closing(ISSUE, 'someone/else')],
          },
        }),
      }))
      expect(step(result, 'pr-closes').status).toBe('no')
    })

    test('blocks a PR that closes two issues', async ({ expect, fresh }) => {
      const { status, result } = await ci(fresh, (head) => ({
        issue: issueAnswer(),
        pr: prAnswer(head, {
          closingIssuesReferences: {
            totalCount: 2,
            nodes: [closing(ISSUE), closing(43)],
          },
        }),
      }))
      expect(status).toBe(1)
      expect(step(result, 'pr-closes').status).toBe('ok')
      expect(step(result, 'pr-closes-only').status).toBe('no')
    })

    test.for([
      ['without the dot', `Closes #${ISSUE}\n\nTexto.`],
      ['with another keyword', `Fixes #${ISSUE}.`],
      ['naming another issue', 'Closes #41.'],
      ['after other text', `Esta PR fecha a issue.\nCloses #${ISSUE}.`],
      ['empty', ''],
    ] as const)(
      'blocks a first line %s',
      async ([, body], { expect, fresh }) => {
        const { status, result } = await ci(fresh, (head) => ({
          issue: issueAnswer(),
          pr: prAnswer(head, { body }),
        }))
        expect(status).toBe(1)
        expect(step(result, 'pr-first-line').status).toBe('no')
      },
    )

    test('accepts "Closes #N." after leading blank lines', async ({
      expect,
      fresh,
    }) => {
      const { result } = await ci(fresh, (head) => ({
        issue: issueAnswer(),
        pr: prAnswer(head, { body: `\n\nCloses #${ISSUE}.\n` }),
      }))
      expect(step(result, 'pr-first-line').status).toBe('ok')
    })

    test('blocks when the PR head branch is not the --branch given', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ci(fresh, (head) => ({
        issue: issueAnswer(),
        pr: prAnswer(head, { headRefName: 'feature/42-other-name' }),
      }))
      expect(status).toBe(1)
      expect(step(result, 'branch').detail).toContain('feature/42-other-name')
    })

    test('blocks when HEAD is not the PR head commit', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ci(fresh, () => ({
        issue: issueAnswer(),
        pr: prAnswer('0'.repeat(40)),
      }))
      expect(status).toBe(1)
      expect(step(result, 'branch').status).toBe('no')
    })

    test('blocks a PR that does not exist', async ({ expect, fresh }) => {
      const { status, result } = await ci(fresh, () => ({
        issue: issueAnswer(),
        pr: failing('missing', PR),
      }))
      expect(status).toBe(1)
      expect(step(result, 'pr-base').detail).toContain(`a PR #${PR} não existe`)
    })

    test('blocks intent-first and learn on a ready PR', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ci(fresh, passingCi, {
        first: { 'src/thing.ts': 'x\n' },
        learn: null,
      })
      expect(status).toBe(1)
      expect(result.blocked).toEqual(['intent-first', 'learn'])
    })

    test('only reports intent-first and learn on a draft PR', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ci(
        fresh,
        (head) => ({
          issue: issueAnswer(),
          pr: prAnswer(head, { isDraft: true }),
        }),
        { first: { 'src/thing.ts': 'x\n' }, learn: null },
      )
      expect(status).toBe(0)
      expect(step(result, 'intent-first')).toMatchObject({
        status: 'no',
        blocks: false,
      })
      expect(step(result, 'learn')).toMatchObject({
        status: 'no',
        blocks: false,
      })
    })

    test('blocks when origin is not the repository the workflow runs in', async ({
      expect,
      fresh,
    }) => {
      const { status, result, calls } = await ci(
        fresh,
        passingCi,
        {},
        {
          GITHUB_REPOSITORY: 'someone/else',
        },
      )
      expect(status).toBe(1)
      expect(step(result, 'repo').detail).toContain('someone/else')
      expect(calls).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // The Copilot review and the review threads (#13)

  describe.concurrent('the Copilot review and the review threads', () => {
    /** The standard work branch in CI mode, with this PR over its head. */
    const ciWith = (
      fresh: Fresh,
      pr: (head: string) => Record<string, unknown>,
    ) =>
      ci(fresh, (head) => ({
        issue: issueAnswer(),
        pr: prAnswer(head, pr(head)),
      }))

    test('reports both steps only in CI mode, and reads no PR locally', async ({
      expect,
      fresh,
    }) => {
      const { status, result, calls } = await local(fresh)
      expect(status).toBe(0)
      for (const id of ['copilot-review', 'review-threads'])
        expect(step(result, id)).toEqual({
          id,
          status: 'skip',
          blocks: false,
          detail: 'só no modo CI',
        })
      expect(calls.map(({ kind }) => kind)).toEqual(['issue'])
    })

    test('passes a Copilot review of the head and resolved threads of any kind', async ({
      expect,
      fresh,
    }) => {
      const { status, result, head } = await ciWith(fresh, (head) => ({
        reviews: connection([
          review(OLD, { submittedAt: at('12:30') }),
          review(head, {
            author: { __typename: 'User', login: OWNER },
            submittedAt: at('12:40'),
          }),
          review(head),
        ]),
        reviewThreads: connection([
          thread(1, { isResolved: true }),
          thread(2, { isResolved: true, isOutdated: true, line: null }),
          thread(3, { isResolved: true }, OWNER),
        ]),
      }))
      expect(status).toBe(0)
      expect(step(result, 'copilot-review')).toEqual({
        id: 'copilot-review',
        status: 'ok',
        blocks: true,
        detail: `revisão do Copilot na cabeça ${head.slice(0, 7)} (COMMENTED em ${at('13:00')})`,
      })
      expect(step(result, 'review-threads')).toEqual({
        id: 'review-threads',
        status: 'ok',
        blocks: true,
        detail: 'nenhuma thread de revisão aberta (3 no total)',
      })
      expect(result.blocked).toEqual([])
    })

    test('passes an APPROVED Copilot review of the head', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ciWith(fresh, (head) => ({
        reviews: connection([review(head, { state: 'APPROVED' })]),
      }))
      expect(status).toBe(0)
      expect(step(result, 'copilot-review').status).toBe('ok')
    })

    // Each refusal of copilot-review, on a PR ready for a merge (blocks) and
    // on a draft (only reported).
    const noReview: [
      string,
      (head: string) => Review[],
      (head: string) => string[],
    ][] = [
      [
        'no review at all',
        () => [],
        () => [
          'nenhuma revisão do Copilot nesta PR',
          'quando a PR sai de draft',
          'uns 6 min',
          REQUEST,
        ],
      ],
      [
        'a review of an older commit only',
        () => [review(OLD)],
        (head) => [
          `a última revisão do Copilot é de ${OLD.slice(0, 7)}, não da cabeça ${head.slice(0, 7)}`,
          REQUEST,
        ],
      ],
      [
        'a review of the head by a User named like Copilot',
        (head) => [
          review(head, {
            author: {
              __typename: 'User',
              login: COPILOT.login,
              databaseId: COPILOT.databaseId,
            },
          }),
        ],
        () => ['nenhuma revisão do Copilot nesta PR', REQUEST],
      ],
      [
        'a review of the head by an Organization named like Copilot',
        (head) => [
          review(head, {
            author: {
              __typename: 'Organization',
              login: COPILOT.login,
              databaseId: COPILOT.databaseId,
            },
          }),
        ],
        () => ['nenhuma revisão do Copilot nesta PR', REQUEST],
      ],
      [
        'a review of the head by another bot with Copilot’s login',
        (head) => [review(head, { author: { ...COPILOT, databaseId: 1 } })],
        () => ['nenhuma revisão do Copilot nesta PR', REQUEST],
      ],
      [
        'a dismissed review of the head',
        (head) => [review(head, { state: 'DISMISSED' })],
        (head) => [
          `de ${head.slice(0, 7)}, está DISMISSED e não conta (contam COMMENTED e APPROVED)`,
          REQUEST,
        ],
      ],
      [
        'a review of the head that requests changes',
        (head) => [review(head, { state: 'CHANGES_REQUESTED' })],
        () => ['está CHANGES_REQUESTED e não conta', REQUEST],
      ],
      [
        'a pending review of the head',
        (head) => [review(head, { state: 'PENDING', submittedAt: null })],
        () => ['está PENDING e não conta', REQUEST],
      ],
      [
        'a review of the head, dismissed, then one of an older commit',
        (head) => [
          review(head, { state: 'DISMISSED', submittedAt: at('12:30') }),
          review(OLD),
        ],
        (head) => [
          `a última revisão do Copilot é de ${OLD.slice(0, 7)}, não da cabeça ${head.slice(0, 7)}`,
        ],
      ],
      [
        'a review of the head that failed with an error',
        (head) => [review(head, { body: ERRORED })],
        (head) => [
          `a revisão do Copilot na cabeça ${head.slice(0, 7)} falhou ("Copilot encountered an error and was unable to review this pull request. You can try again by re-requesting a review."), e uma revisão que falhou não conta`,
          REQUEST,
        ],
      ],
      [
        'a review of the head that could not review any file',
        (head) => [review(head, { body: NO_FILES })],
        (head) => [
          `a revisão do Copilot na cabeça ${head.slice(0, 7)} falhou ("Copilot wasn't able to review any files in this pull request.")`,
          REQUEST,
        ],
      ],
      [
        'a review of the head without a body',
        (head) => [review(head, { body: null })],
        () => ['falhou (o GitHub não deu o corpo dela)', REQUEST],
      ],
      [
        'a review of the head with a blank body',
        (head) => [review(head, { body: ' \n\t ' })],
        () => ['falhou (o corpo dela veio vazio)', REQUEST],
      ],
      [
        'a good review of an older commit, then a failed one of the head',
        (head) => [
          review(OLD, { submittedAt: at('12:30') }),
          review(head, { body: ERRORED }),
        ],
        (head) => [`a revisão do Copilot na cabeça ${head.slice(0, 7)} falhou`],
      ],
      [
        'a failed review of an older commit only',
        () => [review(OLD, { body: NO_FILES })],
        (head) => [
          `a última revisão do Copilot, de ${OLD.slice(0, 7)}, falhou ("Copilot wasn't able to review any files in this pull request."); nenhuma cobre a cabeça ${head.slice(0, 7)}`,
          REQUEST,
        ],
      ],
    ]

    test.for(noReview)(
      'blocks a ready PR with %s',
      async ([, reviews, words], { expect, fresh }) => {
        const { status, result, head } = await ciWith(fresh, (head) => ({
          reviews: connection(reviews(head)),
        }))
        expect(step(result, 'copilot-review')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        for (const word of words(head))
          expect(step(result, 'copilot-review').detail).toContain(word)
        expect(
          step(result, 'copilot-review').detail.endsWith(`; ${RENEW}`),
        ).toBe(true)
        expect(result.blocked).toEqual(['copilot-review'])
        expect(status).toBe(1)
      },
    )

    test('passes a good review of the head even when a later one of it failed', async ({
      expect,
      fresh,
    }) => {
      const { status, result, head } = await ciWith(fresh, (head) => ({
        reviews: connection([
          review(head, { submittedAt: at('12:30') }),
          review(head, { body: ERRORED }),
        ]),
      }))
      expect(step(result, 'copilot-review')).toMatchObject({
        status: 'ok',
        detail: `revisão do Copilot na cabeça ${head.slice(0, 7)} (COMMENTED em ${at('12:30')})`,
      })
      expect(status).toBe(0)
    })

    test.for(noReview)(
      'only reports %s on a draft PR',
      async ([, reviews], { expect, fresh }) => {
        const { status, result } = await ciWith(fresh, (head) => ({
          isDraft: true,
          reviews: connection(reviews(head)),
        }))
        expect(step(result, 'copilot-review')).toMatchObject({
          status: 'no',
          blocks: false,
        })
        expect(result.blocked).toEqual([])
        expect(status).toBe(0)
      },
    )

    /** A review request for `reviewer`, as GitHub's GraphQL gives one. */
    const requestOf = (reviewer: Record<string, unknown> | null) => ({
      requestedReviewer: reviewer,
    })
    /** What a refusal says while a Copilot review is on its way. */
    const coming = (which: string) =>
      `${which} revisão do Copilot foi pedida e ainda não chegou (leva uns 6 min): espere-a e trate as threads dela; se ela não chegar em uns 10 min, peça de novo com ${REQUEST}`

    test('blocks a ready PR whose head Copilot reviewed while another Copilot review is on its way', async ({
      expect,
      fresh,
    }) => {
      const { status, result, head } = await ciWith(fresh, () => ({
        reviewRequests: connection([
          requestOf({ __typename: 'User', login: OWNER }),
          requestOf(COPILOT),
        ]),
      }))
      expect(step(result, 'copilot-review')).toEqual({
        id: 'copilot-review',
        status: 'no',
        blocks: true,
        detail: `há uma revisão do Copilot na cabeça ${head.slice(0, 7)} (COMMENTED em ${at('13:00')}), mas ${coming('outra')}; ${RENEW}`,
      })
      expect(result.blocked).toEqual(['copilot-review'])
      expect(status).toBe(1)
    })

    test('only reports a Copilot review on its way on a draft PR', async ({
      expect,
      fresh,
    }) => {
      const { status, result } = await ciWith(fresh, () => ({
        isDraft: true,
        reviewRequests: connection([requestOf(COPILOT)]),
      }))
      expect(step(result, 'copilot-review')).toMatchObject({
        status: 'no',
        blocks: false,
      })
      expect(result.blocked).toEqual([])
      expect(status).toBe(0)
    })

    // While a Copilot review is on its way, a refusal says to wait for it
    // before requesting one more.
    const onItsWay: [
      string,
      (head: string) => Review[],
      (head: string) => string,
    ][] = [
      [
        'no review yet',
        () => [],
        () =>
          `nenhuma revisão do Copilot nesta PR ainda; ${coming('uma')}; ${RENEW}`,
      ],
      [
        'a failed review of the head',
        (head) => [review(head, { body: ERRORED })],
        (head) =>
          `a revisão do Copilot na cabeça ${head.slice(0, 7)} falhou ("${ERRORED}"), e uma revisão que falhou não conta; ${coming('uma')}; ${RENEW}`,
      ],
      [
        'a failed review of an older commit',
        () => [review(OLD, { body: NO_FILES })],
        (head) =>
          `a última revisão do Copilot, de ${OLD.slice(0, 7)}, falhou ("Copilot wasn't able to review any files in this pull request."); nenhuma cobre a cabeça ${head.slice(0, 7)}; ${coming('uma')}; ${RENEW}`,
      ],
      [
        'a dismissed review of the head',
        (head) => [review(head, { state: 'DISMISSED' })],
        (head) =>
          `a última revisão do Copilot, de ${head.slice(0, 7)}, está DISMISSED e não conta (contam COMMENTED e APPROVED); nenhuma cobre a cabeça ${head.slice(0, 7)}; ${coming('uma')}; ${RENEW}`,
      ],
      [
        'a review of an older commit',
        () => [review(OLD)],
        (head) =>
          `a última revisão do Copilot é de ${OLD.slice(0, 7)}, não da cabeça ${head.slice(0, 7)}; ${coming('uma')}; ${RENEW}`,
      ],
    ]

    test.for(onItsWay)(
      'says to wait for the Copilot review on its way, with %s',
      async ([, reviews, detail], { expect, fresh }) => {
        const { status, result, head } = await ciWith(fresh, (head) => ({
          reviews: connection(reviews(head)),
          reviewRequests: connection([requestOf(COPILOT)]),
        }))
        expect(step(result, 'copilot-review')).toEqual({
          id: 'copilot-review',
          status: 'no',
          blocks: true,
          detail: detail(head),
        })
        expect(status).toBe(1)
      },
    )

    test('says to request a review, not to wait, when none is on its way', async ({
      expect,
      fresh,
    }) => {
      const { result, head } = await ciWith(fresh, () => ({
        reviews: connection([review(OLD)]),
        reviewRequests: connection([requestOf(null)]),
      }))
      expect(step(result, 'copilot-review').detail).toBe(
        `a última revisão do Copilot é de ${OLD.slice(0, 7)}, não da cabeça ${head.slice(0, 7)}; peça de novo com ${REQUEST}; ${RENEW}`,
      )
    })

    // A review requested of anyone but the Copilot bot leaves a review of the
    // head standing: Copilot is matched by type and database id, never login.
    const notCopilot: [string, Record<string, unknown> | null][] = [
      ['a person', { __typename: 'User', login: OWNER }],
      [
        'a person whose login is Copilot’s',
        { __typename: 'User', login: COPILOT.login },
      ],
      ['a team', { __typename: 'Team' }],
      ['another bot', { __typename: 'Bot', databaseId: 1 }],
      ['a Bot without its database id', { __typename: 'Bot' }],
      ['a reviewer GitHub did not give', null],
    ]

    test.for(notCopilot)(
      'passes a review of the head while a review is requested of %s',
      async ([, reviewer], { expect, fresh }) => {
        const { status, result } = await ciWith(fresh, () => ({
          reviewRequests: connection([requestOf(reviewer)]),
        }))
        expect(step(result, 'copilot-review').status).toBe('ok')
        expect(status).toBe(0)
      },
    )

    test('holds a review of the head when Copilot’s request is among a partial page of requests', async ({
      expect,
      fresh,
    }) => {
      const { status, result, head } = await ciWith(fresh, () => ({
        reviewRequests: connection(
          [
            requestOf(COPILOT),
            ...Array.from({ length: 100 }, () =>
              requestOf({ __typename: 'User', login: OWNER }),
            ),
          ],
          101,
        ),
      }))
      expect(step(result, 'copilot-review')).toEqual({
        id: 'copilot-review',
        status: 'no',
        blocks: true,
        detail: `há uma revisão do Copilot na cabeça ${head.slice(0, 7)} (COMMENTED em ${at('13:00')}), mas ${coming('outra')}; ${RENEW}`,
      })
      expect(status).toBe(1)
    })

    test('says to wait when reviews past one page leave the head unreviewed and a Copilot review is on its way', async ({
      expect,
      fresh,
    }) => {
      const { result } = await ciWith(fresh, () => ({
        reviews: connection(
          Array.from({ length: 101 }, (_, i) =>
            review(OLD, {
              submittedAt: at(`12:${String(i % 60).padStart(2, '0')}`),
            }),
          ),
        ),
        reviewRequests: connection([requestOf(COPILOT)]),
      }))
      expect(step(result, 'copilot-review')).toMatchObject({
        status: 'unchecked',
        blocks: true,
      })
      expect(step(result, 'copilot-review').detail).toContain(
        `; as mais antigas ficam sem julgar; ${coming('uma')}; ${RENEW}`,
      )
    })

    // Each refusal of review-threads, ready and draft.
    const openCases: [string, Thread, string][] = [
      [
        'an open thread',
        thread(1),
        `src/file-1.ts:1 de copilot-pull-request-reviewer ${threadUrl(1)}`,
      ],
      [
        'an open outdated thread',
        thread(1, { isOutdated: true, line: null }),
        `src/file-1.ts (desatualizada) de copilot-pull-request-reviewer ${threadUrl(1)}`,
      ],
      [
        'an open thread a person opened',
        thread(1, {}, OWNER),
        `src/file-1.ts:1 de ${OWNER} ${threadUrl(1)}`,
      ],
    ]

    test.for(openCases)(
      'blocks a ready PR with %s',
      async ([, open, named], { expect, fresh }) => {
        const { status, result } = await ciWith(fresh, () => ({
          reviewThreads: connection([thread(2, { isResolved: true }), open]),
        }))
        expect(step(result, 'review-threads')).toEqual({
          id: 'review-threads',
          status: 'no',
          blocks: true,
          detail: `1 de 2 thread(s) de revisão aberta(s): ${named}; responda em cada uma e só então a resolva; ${RENEW}`,
        })
        expect(result.blocked).toEqual(['review-threads'])
        expect(status).toBe(1)
      },
    )

    test.for(openCases)(
      'only reports %s on a draft PR',
      async ([, open], { expect, fresh }) => {
        const { status, result } = await ciWith(fresh, () => ({
          isDraft: true,
          reviewThreads: connection([open]),
        }))
        expect(step(result, 'review-threads')).toMatchObject({
          status: 'no',
          blocks: false,
        })
        expect(result.blocked).toEqual([])
        expect(status).toBe(0)
      },
    )

    test('names ten open threads and counts the rest', async ({
      expect,
      fresh,
    }) => {
      const open = Array.from({ length: 12 }, (_, i) => thread(i + 1))
      const { result } = await ciWith(fresh, () => ({
        reviewThreads: connection([...open, thread(13, { isResolved: true })]),
      }))
      const { detail } = step(result, 'review-threads')
      expect(detail).toContain('12 de 13 thread(s) de revisão aberta(s): ')
      for (let n = 1; n <= 10; n += 1)
        expect(detail).toContain(`src/file-${n}.ts:${n} `)
      expect(detail).not.toContain('src/file-11.ts')
      expect(detail).not.toContain('src/file-12.ts')
      expect(detail).toContain(`${threadUrl(10)}; e mais 2; responda`)
    })

    // Pages are read whole or not judged: a page the gate read only in part
    // leaves the step unchecked, which blocks in CI outside a draft.
    const partial: [
      string,
      string,
      (head: string) => Record<string, unknown>,
      string,
    ][] = [
      [
        'more reviews than one page and none on the head among the newest',
        'copilot-review',
        () => ({
          reviews: connection(
            Array.from({ length: 101 }, (_, i) =>
              review(OLD, {
                submittedAt: at(`12:${String(i % 60).padStart(2, '0')}`),
              }),
            ),
          ),
        }),
        'a PR tem 101 revisões, o gate leu as 100 mais recentes e nenhuma delas é uma revisão do Copilot que conta na cabeça',
      ],
      [
        'more reviews than one page, the head’s only among the unread',
        'copilot-review',
        (head) => ({
          // The page is the newest 100 of 101: the oldest, the only review of
          // the head, is past it.
          reviews: connection([
            review(head, { submittedAt: at('11:00') }),
            ...Array.from({ length: 100 }, () =>
              review(head, {
                author: { __typename: 'User', login: OWNER },
                submittedAt: at('12:00'),
              }),
            ),
          ]),
        }),
        'a PR tem 101 revisões, o gate leu as 100 mais recentes',
      ],
      [
        'reviews without a count',
        'copilot-review',
        (head) => ({ reviews: { nodes: [review(head)] } }),
        'o GitHub não disse quantas revisões a PR tem',
      ],
      [
        'more review requests than one page, none of them Copilot’s, over a review of the head',
        'copilot-review',
        () => ({
          reviewRequests: connection(
            Array.from({ length: 101 }, () => ({
              requestedReviewer: { __typename: 'User', login: OWNER },
            })),
          ),
        }),
        'mas a PR tem 101 pedidos de revisão e o gate leu 100; sem ler todos, o gate não sabe se outra revisão do Copilot está a caminho',
      ],
      [
        'review requests without a count, over a review of the head',
        'copilot-review',
        () => ({ reviewRequests: { nodes: [] } }),
        'mas o GitHub não disse quantos pedidos de revisão a PR tem (o gate leu 0)',
      ],
      [
        'no review requests from GitHub, over a review of the head',
        'copilot-review',
        () => ({ reviewRequests: null }),
        'mas o GitHub não disse quantos pedidos de revisão a PR tem (o gate leu 0)',
      ],
      [
        'more threads than one page',
        'review-threads',
        () => ({
          reviewThreads: connection(
            Array.from({ length: 101 }, (_, i) =>
              thread(i + 1, { isResolved: true }),
            ),
          ),
        }),
        'a PR tem 101 threads de revisão e o gate leu 100',
      ],
      [
        'threads without a count',
        'review-threads',
        () => ({ reviewThreads: { nodes: [] } }),
        'o GitHub não disse quantas threads de revisão a PR tem',
      ],
    ]

    test.for(partial)(
      'leaves the step unchecked and blocking with %s',
      async ([, id, pr, words], { expect, fresh }) => {
        const { status, result } = await ciWith(fresh, pr)
        expect(step(result, id)).toMatchObject({
          status: 'unchecked',
          blocks: true,
        })
        expect(step(result, id).detail).toContain(words)
        // Every refusal says how to renew the verdict once it is fixed.
        expect(step(result, id).detail).toContain('renove o veredito')
        expect(result.blocked).toEqual([id])
        expect(status).toBe(1)
      },
    )

    test('passes a review of the head among the newest of more reviews than one page', async ({
      expect,
      fresh,
    }) => {
      // Every reply in a thread is a review too: a long PR passes 100.
      const { status, result, head } = await ciWith(fresh, (head) => ({
        reviews: connection([
          ...Array.from({ length: 100 }, () =>
            review(head, {
              author: { __typename: 'User', login: OWNER },
              submittedAt: at('12:00'),
            }),
          ),
          review(head),
        ]),
      }))
      expect(step(result, 'copilot-review')).toEqual({
        id: 'copilot-review',
        status: 'ok',
        blocks: true,
        detail: `revisão do Copilot na cabeça ${head.slice(0, 7)} (COMMENTED em ${at('13:00')}), entre as 100 mais recentes de 101 revisões`,
      })
      expect(result.blocked).toEqual([])
      expect(status).toBe(0)
    })

    test.for(partial)(
      'only reports %s on a draft PR',
      async ([, id, pr], { expect, fresh }) => {
        const { status, result } = await ciWith(fresh, (head) => ({
          isDraft: true,
          ...pr(head),
        }))
        expect(step(result, id)).toMatchObject({
          status: 'unchecked',
          blocks: false,
        })
        expect(status).toBe(0)
      },
    )

    test.for([
      ['missing', 'no', `a PR #${PR} não existe`],
      ['unreachable', 'unchecked', 'PR não lida'],
    ] as const)(
      'blocks both steps when the PR is %s',
      async ([mode, status, words], { expect, fresh }) => {
        const run = await ci(fresh, () => ({
          issue: issueAnswer(),
          pr: failing(mode, PR),
        }))
        for (const id of ['copilot-review', 'review-threads']) {
          expect(step(run.result, id)).toMatchObject({ status, blocks: true })
          expect(step(run.result, id).detail).toContain(words)
          expect(run.result.blocked).toContain(id)
        }
        expect(run.status).toBe(1)
      },
    )

    test('prints both steps in the report a person reads', async ({
      expect,
      fresh,
    }) => {
      const { out } = await ciWith(fresh, () => ({
        reviews: connection([]),
        reviewThreads: connection([thread(1)]),
      }))
      expect(out).toMatch(
        /^ {2}\[ \] copilot-review: nenhuma revisão do Copilot/m,
      )
      expect(out).toMatch(/^ {2}\[ \] review-threads: 1 de 1 thread/m)
      expect(out).toContain(`Build BLOQUEADO na #${ISSUE}:`)
    })
  })

  // ---------------------------------------------------------------------------
  // The issue-link workflow's --review-report (#30)

  describe.concurrent(
    '--review-report, the option of the issue-link workflow (#30)',
    () => {
      const REPORT = '--review-report'
      const WAITING_REVIEW =
        '::warning title=O merge espera a revisão do Copilot::'
      const WAITING_THREADS =
        '::warning title=O merge espera as threads de revisão::'

      /**
       * CI mode with the option issue-link.yml passes, over this PR, and the
       * job summary the gate appends to, when it writes one.
       */
      const report = async (
        fresh: Fresh,
        pr: (head: string) => Record<string, unknown>,
      ) => {
        const repo = await fresh()
        await workBranch(repo)
        const summary = path.join(repo.root, 'summary.md')
        const run = await ciOver(
          repo,
          (head) => ({ issue: issueAnswer(), pr: prAnswer(head, pr(head)) }),
          { env: { GITHUB_STEP_SUMMARY: summary }, args: [REPORT] },
        )
        return {
          ...run,
          summary: existsSync(summary) ? readFileSync(summary, 'utf8') : null,
        }
      }

      test('passes a ready PR still waiting for the Copilot review, and warns on the PR', async ({
        expect,
        fresh,
      }) => {
        const { status, result, stderr, summary } = await report(fresh, () => ({
          reviews: connection([]),
        }))
        expect(step(result, 'copilot-review')).toMatchObject({
          status: 'no',
          blocks: false,
        })
        // The fresh verdict it points to runs without the option.
        expect(
          step(result, 'copilot-review').detail.endsWith(`; ${RENEW}`),
        ).toBe(true)
        expect(result.blocked).toEqual([])
        expect(result.open).toBe(true)
        expect(status).toBe(0)
        expect(stderr).toContain(
          `${WAITING_REVIEW}nenhuma revisão do Copilot nesta PR`,
        )
        expect(summary).toContain('O merge espera a revisão do Copilot')
        expect(summary).toContain('`copilot-review`')
        expect(summary).toContain(
          `node scripts/gate.mjs --pr ${PR} --branch ${BRANCH}`,
        )
      })

      test('passes a ready PR with an open thread, and warns on the PR', async ({
        expect,
        fresh,
      }) => {
        const { status, result, stderr, summary } = await report(
          fresh,
          (head) => ({
            reviews: connection([review(head)]),
            reviewThreads: connection([thread(1)]),
          }),
        )
        expect(step(result, 'review-threads')).toMatchObject({
          status: 'no',
          blocks: false,
        })
        expect(result.blocked).toEqual([])
        expect(status).toBe(0)
        expect(stderr).toContain(`${WAITING_THREADS}1 de 1 thread`)
        expect(stderr).not.toContain(WAITING_REVIEW)
        expect(summary).toContain('`review-threads`')
      })

      test('warns about nothing when the review and the threads are in order', async ({
        expect,
        fresh,
      }) => {
        const { status, result, stderr, summary } = await report(
          fresh,
          () => ({}),
        )
        expect(step(result, 'copilot-review').status).toBe('ok')
        expect(status).toBe(0)
        expect(stderr).not.toContain('::warning')
        expect(summary).toBeNull()
      })

      test('reports a draft as before, with no warning', async ({
        expect,
        fresh,
      }) => {
        const { status, result, stderr, summary } = await report(fresh, () => ({
          isDraft: true,
          reviews: connection([]),
        }))
        expect(step(result, 'copilot-review')).toMatchObject({
          status: 'no',
          blocks: false,
        })
        expect(status).toBe(0)
        expect(stderr).not.toContain('::warning')
        expect(summary).toBeNull()
      })

      test('still blocks every other step', async ({ expect, fresh }) => {
        const { status, result } = await report(fresh, () => ({
          reviews: connection([]),
          body: 'Uma PR sem a linha de fechamento.',
        }))
        expect(result.blocked).toEqual(['pr-first-line'])
        expect(status).toBe(1)
      })

      test('escapes in the annotation what a workflow command cannot carry', async ({
        expect,
        fresh,
      }) => {
        const { stderr } = await report(fresh, (head) => ({
          reviews: connection([review(head)]),
          reviewThreads: connection([thread(1, { path: 'src/100%.ts' })]),
        }))
        // The report a person reads keeps the path as it is; only the
        // workflow command escapes it.
        const annotation = stderr
          .split('\n')
          .find((line) => line.startsWith('::warning'))
        expect(annotation).toContain('src/100%25.ts')
        expect(annotation).not.toContain('src/100%.ts')
      })

      test('writes the annotations on stdout without --json, where the workflow reads them', async ({
        expect,
        fresh,
      }) => {
        const repo = await fresh()
        await workBranch(repo)
        const head = await repo.head()
        await repo.git('switch', '-q', '--detach')
        await repo.git('branch', '-q', '-D', BRANCH)
        await repo.git('branch', '-q', '-D', 'main')
        const trusted = installGate(path.join(repo.root, 'trusted'))
        const run = await repo.gate(
          ['--pr', String(PR), '--branch', BRANCH, REPORT],
          {
            fixture: {
              issue: issueAnswer(),
              pr: prAnswer(head, { reviews: connection([]) }),
            },
            script: trusted,
            env: { GITHUB_REPOSITORY: `${OWNER}/${NAME}` },
          },
        )
        expect(run.status).toBe(0)
        expect(run.stdout).toMatch(
          new RegExp(
            `^${WAITING_REVIEW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'm',
          ),
        )
        expect(run.stdout).toContain(`O gate está aberto para a #${ISSUE}.`)
      })

      test('is refused outside the CI mode', async ({ expect, fresh }) => {
        const repo = await fresh()
        await workBranch(repo)
        const run = await repo.gate([REPORT], {
          fixture: { issue: issueAnswer() },
        })
        expect(run.status).toBe(2)
        expect(run.stderr).toContain('--review-report só vale no modo CI')
      })
    },
  )

  // ---------------------------------------------------------------------------
  // The cache and the command line

  describe.concurrent('cache', () => {
    test('writes the local verdict under the worktree git dir', async ({
      expect,
      fresh,
    }) => {
      const { repo, result } = await local(fresh)
      const cache = await readCache(repo)
      expect(cache).toMatchObject({
        schema: gateCacheSchema,
        repo: `${OWNER}/${NAME}`,
        branch: BRANCH,
        issue: ISSUE,
        headSha: await repo.head(),
        open: true,
        verified: true,
        checkedAt: result.checkedAt,
      })
      expect(
        (cache.steps as { id: string }[]).map((entry) => entry.id),
      ).toEqual([...stepIds])
    })

    test('records a blocked verdict as closed', async ({ expect, fresh }) => {
      const { repo } = await local(fresh, {
        labels: ['enhancement', 'ready-for-human'],
      })
      expect(await readCache(repo)).toMatchObject({
        open: false,
        verified: true,
      })
    })

    test('writes nothing with --no-cache', async ({ expect, fresh }) => {
      const { repo } = await local(fresh, {}, {}, ['--no-cache'])
      expect(existsSync(path.join(await repo.gitDir(), gateCacheFile))).toBe(
        false,
      )
    })
  })

  describe.concurrent('command line', () => {
    test.for([
      ['--verbose'],
      ['--pr', '7'],
      ['--branch', BRANCH],
      ['--pr', 'abc', '--branch', BRANCH],
      ['--pr'],
    ])('exits 2 on a usage error: %s', async (args, { expect, fresh }) => {
      const repo = await fresh()
      const { status, stderr, calls } = await repo.gate(args, {
        fixture: { issue: issueAnswer() },
      })
      expect(status).toBe(2)
      expect(stderr).toContain('Uso:')
      expect(calls).toEqual([])
    })

    test('prints the owner rule on a blocked run too', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      await workBranch(repo)
      const { status, stdout } = await repo.gate([], {
        fixture: { issue: issueAnswer({ comments: [] }) },
      })
      expect(status).toBe(1)
      expect(stdout.trimEnd().endsWith(ownerRule)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // The fake itself

  test('the fake gh refuses an argv shape the gate does not send', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    writeFileSync(
      repo.fixturePath,
      JSON.stringify({ owner: OWNER, name: NAME, issue: issueAnswer() }),
    )
    const run = await exec(
      path.join(repo.bin, 'gh'),
      ['issue', 'view', String(ISSUE), '--json', 'body'],
      {
        timeout: 60_000,
        env: repo.env({
          FAKE_GH_LOG: repo.log,
          FAKE_GH_FIXTURE: repo.fixturePath,
          GH_PROMPT_DISABLED: '1',
          GH_NO_UPDATE_NOTIFIER: '1',
        }),
      },
    )
    expect(run.status).toBe(97)
    expect(readFileSync(repo.log, 'utf8')).toContain('argv inesperado')
  })

  describe.concurrent(
    'a stack of PRs, each slice a sub-issue of its parent (#31)',
    () => {
      const PARENT = 40
      const SLICES = [
        'feature/43-fatia-base',
        'feature/44-fatia-meio',
        'feature/45-fatia-topo',
      ] as const
      const [BOTTOM, MIDDLE, TOP] = SLICES
      const numberOf = (branch: string) => parseBranch(branch)?.issue ?? 0
      const STACK_INTENT = 'context/intent/feature-a-stack.md'
      const STACK_ENTRY = `## 2026-09-20: A stack inteira (#${PARENT})`

      /** A parent's plan: a feature plan whose Stack section lists the slices, bottom first. */
      const parentBody = (branches: readonly string[] = SLICES) =>
        `${featureBody({ Plano: 'As fatias estão na seção Stack.' })}\n## Stack\n\nDe baixo para cima:\n\n${branches
          .map((branch, i) => `${i + 1}. \`${branch}\``)
          .join('\n')}\n`

      /** The parent: its plan with the Stack, and the three slices as its sub-issues. */
      const parentAnswer = (options: IssueOptions = {}) =>
        issueAnswer({
          number: PARENT,
          body: parentBody(),
          subIssues: SLICES.map((branch) => ({ number: numberOf(branch) })),
          ...options,
        })

      /** The parent after the given slices merged: their sub-issues closed, as their PRs leave them. */
      const parentAfter = (
        merged: readonly string[],
        options: IssueOptions = {},
      ) =>
        parentAnswer({
          subIssues: SLICES.map((branch) => ({
            number: numberOf(branch),
            state: merged.includes(branch) ? 'CLOSED' : 'OPEN',
          })),
          ...options,
        })

      /** A slice's sub-issue: its category and the slice label, no state label, no plan of its own. */
      const sliceAnswer = (branch: string, options: IssueOptions = {}) =>
        issueAnswer({
          number: numberOf(branch),
          parent: PARENT,
          body: `Fatia da stack da #${PARENT}.`,
          labels: ['enhancement', 'stack-slice'],
          comments: [],
          events: [
            labeled('enhancement', at('10:00')),
            labeled('stack-slice', at('10:00')),
          ],
          ...options,
        })

      /** A slice's PR: it closes the slice's sub-issue. */
      const slicePr = (
        head: string,
        branch: string,
        overrides: Record<string, unknown> = {},
      ) =>
        prAnswer(head, {
          headRefName: branch,
          body: `Closes #${numberOf(branch)}.\n\n## Risco\n\nHIGH.`,
          closingIssuesReferences: {
            totalCount: 1,
            nodes: [closing(numberOf(branch))],
          },
          ...overrides,
        })

      /** A slice cut from `from`, two commits citing its sub-issue, published. */
      const slice = async (
        repo: TempRepo,
        branch: string,
        from: string,
        first: Record<string, string>,
        second: Record<string, string>,
      ) => {
        await repo.git('switch', '-q', '-c', branch, from)
        await repo.commit(
          first,
          `Primeiro commit da fatia (Refs #${numberOf(branch)})`,
        )
        await repo.commit(
          second,
          `Segundo commit da fatia (Refs #${numberOf(branch)})`,
        )
        await repo.publish(branch)
      }

      /**
       * The three slices, each cut from the one below: the first starts with
       * the intent, the last carries the Learn citing the parent.
       */
      const stack = async (
        fresh: Fresh,
        learn = `# Changelog\n\n${STACK_ENTRY}\n\nO que mudou.\n`,
      ) => {
        const repo = await fresh()
        await slice(
          repo,
          BOTTOM,
          'main',
          { [STACK_INTENT]: '# Intent\n' },
          {
            'src/base.ts': 'export const base = 1\n',
          },
        )
        await slice(
          repo,
          MIDDLE,
          BOTTOM,
          { 'src/meio.ts': 'export const meio = 1\n' },
          {
            'src/meio-2.ts': 'export const meio2 = 1\n',
          },
        )
        await slice(
          repo,
          TOP,
          MIDDLE,
          { 'src/topo.ts': 'export const topo = 1\n' },
          {
            [CHANGELOG]: learn,
          },
        )
        return repo
      }

      /** The local gate on `branch`, a slice, with its sub-issue and parent as given. */
      const onSlice = async (
        repo: TempRepo,
        branch: string,
        issue = sliceAnswer(branch),
        parent: GhAnswer | undefined = parentAnswer(),
      ) => {
        await repo.git('switch', '-q', branch)
        return repo.gateJson([], {
          fixture: parent === undefined ? { issue } : { issue, parent },
        })
      }

      /** CI mode on `branch`, with only the published refs, the way the checkout leaves them. */
      const ciOnSlice = async (
        repo: TempRepo,
        branch: string,
        pr: (head: string) => GhAnswer,
        parent: GhAnswer = parentAnswer(),
      ) => {
        await repo.git('switch', '-q', branch)
        const locals = (
          await repo.git(
            'for-each-ref',
            '--format=%(refname:short)',
            'refs/heads',
          )
        )
          .split('\n')
          .filter(Boolean)
        for (const other of locals)
          if (other !== branch && other !== 'main')
            await repo.git('branch', '-q', '-D', other)
        return ciOver(
          repo,
          (head) => ({ issue: sliceAnswer(branch), parent, pr: pr(head) }),
          { branch },
        )
      }

      /**
       * Merges a slice into main with a merge commit, moves origin/main, and
       * deletes the branch here and on origin, as the repository does on merge.
       */
      const mergeIntoMain = async (repo: TempRepo, branch: string) => {
        await repo.git('switch', '-q', 'main')
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          `Merge ${branch} (#${numberOf(branch)})`,
          branch,
        )
        await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        await repo.git('branch', '-q', '-D', branch)
        await repo.git('update-ref', '-d', `refs/remotes/origin/${branch}`)
      }

      test('judges a slice by its parent: the state label, the plan, the Approve and the Stack', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const { result } = await onSlice(repo, MIDDLE)
        expect(result.open).toBe(true)
        expect(step(result, 'issue-open').detail).toBe(
          `#44 e a mãe #${PARENT} estão abertas`,
        )
        expect(step(result, 'state-label')).toMatchObject({
          status: 'ok',
          detail: `ready-for-agent, na mãe #${PARENT} (a #44 é uma fatia da stack dela)`,
        })
        expect(step(result, 'sections').detail).toContain(
          `corpo da mãe #${PARENT}`,
        )
        expect(step(result, 'approve')).toMatchObject({ status: 'ok' })
        expect(step(result, 'approve').detail).toContain(`(na mãe #${PARENT})`)
        expect(step(result, 'branch-in-plan')).toMatchObject({ status: 'ok' })
        expect(step(result, 'branch-in-plan').detail).toContain(
          `cita ${MIDDLE}: fatia 2 de 3`,
        )
        // The slice below shares its history by design, and the one above holds
        // all of it; neither is foreign, and only this slice's commits are its own.
        expect(step(result, 'stacked')).toMatchObject({ status: 'ok' })
        expect(step(result, 'stacked').detail).toContain(BOTTOM)
        expect(step(result, 'commits-cite-issue').detail).toBe(
          '2 commit(s) próprio(s), todos citam #44',
        )
      })

      test('reads the parent only for a sub-issue that carries the slice label', async ({
        expect,
        fresh,
      }) => {
        // A plain sub-issue of #1 is judged by its own plan, as before: the fake
        // gh has no answer for #1, and would refuse the query.
        const { result } = await local(fresh, { parent: 1 })
        expect(result.open).toBe(true)
        expect(step(result, 'issue-open').detail).toBe(`#${ISSUE} está aberta`)
      })

      test('lets a slice PR point at the slice below while it is a draft', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const { result } = await ciOnSlice(repo, MIDDLE, (head) =>
          slicePr(head, MIDDLE, { baseRefName: BOTTOM, isDraft: true }),
        )
        expect(step(result, 'pr-base')).toMatchObject({
          status: 'ok',
          detail: `${BOTTOM}, a fatia logo abaixo na stack da #${PARENT}, com a PR em draft`,
        })
        expect(result.blocked).toEqual([])
      })

      test('refuses a slice PR that points at the slice below out of draft', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const { result } = await ciOnSlice(repo, MIDDLE, (head) =>
          slicePr(head, MIDDLE, { baseRefName: BOTTOM }),
        )
        expect(step(result, 'pr-base')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'pr-base').detail).toContain('não está em draft')
        expect(result.blocked).toContain('pr-base')
      })

      test('refuses a slice PR that points at a slice other than the one below', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const { result } = await ciOnSlice(repo, TOP, (head) =>
          slicePr(head, TOP, { baseRefName: BOTTOM, isDraft: true }),
        )
        expect(step(result, 'pr-base')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'pr-base').detail).toBe(
          `a PR aponta para ${BOTTOM}, não para main nem para a fatia de baixo, ${MIDDLE}`,
        )
      })

      test('holds the intent to the first slice only', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const first = await ciOnSlice(repo, BOTTOM, (head) =>
          slicePr(head, BOTTOM),
        )
        expect(step(first.result, 'intent-first')).toMatchObject({
          status: 'ok',
          blocks: true,
        })
        // The Learn goes with the last slice: the first one opens without it.
        expect(step(first.result, 'learn').blocks).toBe(false)
        expect(first.result.blocked).toEqual([])
      })

      test('lets a middle slice open without its own intent or Learn, and says why', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await mergeIntoMain(repo, BOTTOM)
        const { result, out } = await ciOnSlice(
          repo,
          MIDDLE,
          (head) => slicePr(head, MIDDLE),
          parentAfter([BOTTOM]),
        )
        expect(step(result, 'intent-first')).toMatchObject({
          status: 'no',
          blocks: false,
        })
        expect(step(result, 'learn').blocks).toBe(false)
        expect(result.blocked).toEqual([])
        expect(out).toContain(
          `só relata: na stack da #${PARENT}, o intent vai na primeira fatia (${BOTTOM})`,
        )
        expect(out).toContain(
          `só relata: na stack da #${PARENT}, o Learn vai na última fatia (${TOP}), citando a #${PARENT}`,
        )
      })

      test('holds the Learn to the last slice, citing the parent', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await mergeIntoMain(repo, BOTTOM)
        await mergeIntoMain(repo, MIDDLE)
        const { result } = await ciOnSlice(
          repo,
          TOP,
          (head) => slicePr(head, TOP),
          parentAfter([BOTTOM, MIDDLE]),
        )
        expect(step(result, 'learn')).toMatchObject({
          status: 'ok',
          blocks: true,
        })
        expect(step(result, 'learn').detail).toContain(STACK_ENTRY)
        expect(step(result, 'intent-first').blocks).toBe(false)
        expect(result.blocked).toEqual([])
      })

      test('refuses a last slice whose Learn cites the slice instead of the parent', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(
          fresh,
          '# Changelog\n\n## 2026-09-20: Só a fatia (#45)\n\nO que mudou.\n',
        )
        const { result } = await ciOnSlice(repo, TOP, (head) =>
          slicePr(head, TOP),
        )
        expect(step(result, 'learn')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'learn').detail).toContain(`(#${PARENT})`)
      })

      test('refuses a branch the parent’s Stack does not name', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const outside = 'feature/46-fora-da-stack'
        await slice(
          repo,
          outside,
          MIDDLE,
          { 'src/fora.ts': 'x\n' },
          { 'src/fora-2.ts': 'y\n' },
        )
        const { result } = await onSlice(repo, outside)
        expect(step(result, 'branch-in-plan')).toMatchObject({ status: 'no' })
        expect(step(result, 'branch-in-plan').detail).toContain(
          `não cita a branch ${outside}`,
        )
        expect(result.open).toBe(false)
      })

      test('refuses a slice whose parent has no Approve, or had its plan revised after it', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const none = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({ comments: [] }),
        )
        expect(step(none.result, 'approve')).toMatchObject({ status: 'no' })
        expect(step(none.result, 'approve').detail).toContain(
          `(na mãe #${PARENT} e na fatia #44)`,
        )
        const revised = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            comments: [
              approve(),
              comment(`# Plano\n\n${parentBody()}`, at('13:00')),
            ],
          }),
        )
        expect(step(revised.result, 'approve')).toMatchObject({ status: 'no' })
        expect(revised.result.open).toBe(false)
      })

      test('refuses a slice with no parent, one with a state label of its own, and one whose parent is closed', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const orphan = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE, { parent: null }),
          undefined,
        )
        for (const id of [
          'state-label',
          'sections',
          'approve',
          'branch-in-plan',
        ])
          expect(step(orphan.result, id)).toMatchObject({ status: 'no' })
        expect(step(orphan.result, 'state-label').detail).toContain(
          'mas não é sub-issue de nenhuma issue',
        )
        const labeled = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE, {
            labels: ['enhancement', 'stack-slice', 'ready-for-agent'],
          }),
        )
        expect(step(labeled.result, 'state-label')).toMatchObject({
          status: 'no',
        })
        expect(step(labeled.result, 'state-label').detail).toContain(
          'uma fatia não leva label de estado',
        )
        const closed = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({ state: 'CLOSED' }),
        )
        expect(step(closed.result, 'issue-open')).toMatchObject({
          status: 'no',
          detail: `a mãe #${PARENT} da fatia #44 está fechada`,
        })
      })

      test('refuses a slice when the parent’s plan has no Stack, or names other branches', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const noStack = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({ body: featureBody() }),
        )
        expect(step(noStack.result, 'branch-in-plan').detail).toContain(
          'não tem a seção Stack',
        )
        const other = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            body: parentBody(['feature/47-outra', 'feature/48-mais']),
          }),
        )
        expect(step(other.result, 'branch-in-plan')).toMatchObject({
          status: 'no',
        })
      })

      // A branch that forks from a slice below shares only that slice's
      // history, which this slice carries by design. One this slice carries
      // is refused (middleOverForeign, below).
      test('refuses a branch outside the stack that shares this slice’s own history, and not one that forks from a slice below', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await slice(
          repo,
          'feature/60-outra',
          BOTTOM,
          { 'src/outra.ts': 'x\n' },
          {
            'src/outra-2.ts': 'y\n',
          },
        )
        const sibling = await onSlice(repo, MIDDLE)
        expect(step(sibling.result, 'stacked')).toMatchObject({ status: 'ok' })
        await slice(
          repo,
          'feature/62-sobre',
          MIDDLE,
          { 'src/sobre.ts': 'x\n' },
          { 'src/sobre-2.ts': 'y\n' },
        )
        // Built on this slice's commits, it is refused by its own gate, not
        // by this one, as for any branch.
        const above = await onSlice(repo, MIDDLE)
        expect(step(above.result, 'stacked')).toMatchObject({ status: 'ok' })
        await repo.git('switch', '-q', MIDDLE)
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          'Traz outra (Refs #44)',
          'feature/62-sobre',
        )
        await repo.publish(MIDDLE)
        const carried = await onSlice(repo, MIDDLE)
        expect(step(carried.result, 'stacked')).toMatchObject({ status: 'no' })
      })

      test('takes a merge of the slice below as an update, and a merge of any other branch as foreign', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await repo.git('switch', '-q', BOTTOM)
        await repo.commit(
          { 'src/base.ts': 'export const base = 2\n' },
          'Corrige a base (Refs #43)',
        )
        await repo.publish(BOTTOM)
        await repo.git('switch', '-q', MIDDLE)
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          'Traz a fatia de baixo (Refs #44)',
          BOTTOM,
        )
        await repo.publish(MIDDLE)
        const updated = await onSlice(repo, MIDDLE)
        expect(step(updated.result, 'stacked')).toMatchObject({ status: 'ok' })
        expect(step(updated.result, 'commits-cite-issue').detail).toBe(
          '2 commit(s) próprio(s), todos citam #44',
        )
        await slice(
          repo,
          'feature/61-lado',
          'main',
          { 'src/lado.ts': 'x\n' },
          {
            'src/lado-2.ts': 'y\n',
          },
        )
        await repo.git('switch', '-q', MIDDLE)
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          'Traz outra branch (Refs #44)',
          'feature/61-lado',
        )
        await repo.git('branch', '-q', '-D', 'feature/61-lado')
        await repo.git(
          'update-ref',
          '-d',
          'refs/remotes/origin/feature/61-lado',
        )
        const foreign = await onSlice(repo, MIDDLE)
        expect(step(foreign.result, 'stacked')).toMatchObject({ status: 'no' })
        expect(step(foreign.result, 'stacked').detail).toContain(
          'um merge traz commits de fora de origin/main',
        )
      })

      test('reports the size of a PR against its base, and never blocks on it', async ({
        expect,
        fresh,
      }) => {
        const small = await ci(fresh, passingCi)
        expect(step(small.result, 'pr-size')).toMatchObject({
          status: 'ok',
          blocks: false,
          detail:
            '50 linha(s) alterada(s) (+40 −10) em 3 arquivo(s), contra main',
        })
        const big = await ci(fresh, (head) => ({
          issue: issueAnswer(),
          pr: prAnswer(head, {
            additions: 1900,
            deletions: 200,
            changedFiles: 40,
          }),
        }))
        expect(step(big.result, 'pr-size')).toMatchObject({
          status: 'no',
          blocks: false,
        })
        expect(step(big.result, 'pr-size').detail).toContain(
          'acima da referência de 1500: considere quebrar a mudança numa stack',
        )
        expect(big.result.blocked).toEqual([])
      })

      // The adversarial verification of #31, one case per finding, each with
      // the control that shows the case is the finding and nothing else.

      /** CI mode on `branch`, every other local branch deleted first. */
      const ciAt = async (
        repo: TempRepo,
        branch: string,
        fixture: (head: string) => GhFixture,
        pathOverride?: string,
      ) => {
        await repo.git('switch', '-q', branch)
        const locals = (
          await repo.git(
            'for-each-ref',
            '--format=%(refname:short)',
            'refs/heads',
          )
        )
          .split('\n')
          .filter(Boolean)
        for (const other of locals)
          if (other !== branch && other !== 'main')
            await repo.git('branch', '-q', '-D', other)
        return ciOver(repo, fixture, { branch, pathOverride })
      }

      const sliceCi =
        (
          branch: string,
          pr: Record<string, unknown> = {},
          parent: GhAnswer = parentAnswer(),
        ) =>
        (head: string): GhFixture => ({
          issue: sliceAnswer(branch),
          parent,
          pr: slicePr(head, branch, pr),
        })

      /** A stack whose first slice starts with code: nothing in it touches the intent. */
      const stackWithoutIntent = async (fresh: Fresh) => {
        const repo = await fresh()
        await slice(
          repo,
          BOTTOM,
          'main',
          { 'src/base.ts': '1\n' },
          { 'src/base-2.ts': '2\n' },
        )
        await slice(
          repo,
          MIDDLE,
          BOTTOM,
          { 'src/meio.ts': 'x\n' },
          { 'src/meio-2.ts': 'y\n' },
        )
        await slice(
          repo,
          TOP,
          MIDDLE,
          { 'src/topo.ts': 'x\n' },
          {
            [CHANGELOG]: `# Changelog\n\n${STACK_ENTRY}\n\nO que mudou.\n`,
          },
        )
        return repo
      }

      test('refuses a slice on main while a slice below is not merged, so the stack merges bottom first', async ({
        expect,
        fresh,
      }) => {
        const control = await stackWithoutIntent(fresh)
        const bottom = await ciAt(control, BOTTOM, sliceCi(BOTTOM))
        expect(bottom.result.blocked).toContain('intent-first')
        const repo = await stackWithoutIntent(fresh)
        const { result } = await ciAt(repo, TOP, sliceCi(TOP))
        expect(step(result, 'pr-base')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'pr-base').detail).toBe(
          `a PR aponta para main, mas as fatias de baixo ${BOTTOM}, ${MIDDLE} ainda não foram mergeadas em main (a sub-issue de cada uma fecha no merge): até lá, a base desta é a fatia logo abaixo (${MIDDLE}), com a PR em draft`,
        )
        expect(result.open).toBe(false)
      })

      test('refuses a middle slice on main that carries a foreign merge through the slice below', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await slice(
          repo,
          'feature/61-lado',
          'main',
          { 'src/lado.ts': 'x\n' },
          { 'src/lado-2.ts': 'y\n' },
        )
        await repo.git('switch', '-q', BOTTOM)
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          'Traz outra branch (Refs #43)',
          'feature/61-lado',
        )
        await repo.publish(BOTTOM)
        await repo.git('branch', '-q', '-D', 'feature/61-lado')
        await repo.git(
          'update-ref',
          '-d',
          'refs/remotes/origin/feature/61-lado',
        )
        await repo.git('switch', '-q', MIDDLE)
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          'Traz a fatia de baixo (Refs #44)',
          BOTTOM,
        )
        await repo.publish(MIDDLE)
        const bottom = await onSlice(repo, BOTTOM)
        expect(step(bottom.result, 'stacked')).toMatchObject({ status: 'no' })
        const { result } = await ciAt(repo, MIDDLE, sliceCi(MIDDLE))
        expect(result.open).toBe(false)
        expect(result.blocked).toContain('pr-base')
      })

      /** The first slice merged; the middle one cut from a foreign lane (#60) whose ref is then gone. */
      const middleOverForeign = async (fresh: Fresh) => {
        const repo = await fresh()
        await slice(
          repo,
          BOTTOM,
          'main',
          { [STACK_INTENT]: '# Intent\n' },
          { 'src/base.ts': '1\n' },
        )
        await mergeIntoMain(repo, BOTTOM)
        await slice(
          repo,
          'feature/60-outra',
          'main',
          { 'src/outra.ts': 'x\n' },
          { 'src/outra-2.ts': 'y\n' },
        )
        await slice(
          repo,
          MIDDLE,
          'feature/60-outra',
          { 'src/meio.ts': 'x\n' },
          { 'src/meio-2.ts': 'y\n' },
        )
        await repo.git('branch', '-q', '-D', 'feature/60-outra')
        await repo.git(
          'update-ref',
          '-d',
          'refs/remotes/origin/feature/60-outra',
        )
        return repo
      }

      test('refuses a slice above the first that carries commits of a lane whose ref is gone', async ({
        expect,
        fresh,
      }) => {
        // Control: a plain issue with the same history is caught by intent-first.
        const plain = await middleOverForeign(fresh)
        const control = await ciAt(plain, MIDDLE, (head) => ({
          issue: issueAnswer({ number: 44, body: featureBody({}, MIDDLE) }),
          pr: slicePr(head, MIDDLE),
        }))
        expect(control.result.blocked).toContain('intent-first')
        const repo = await middleOverForeign(fresh)
        const { result } = await ciAt(repo, MIDDLE, sliceCi(MIDDLE))
        expect(step(result, 'commits-cite-issue')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'commits-cite-issue').detail).toContain(
          '(Refs #60)',
        )
        expect(result.open).toBe(false)
      })

      test('refuses a slice that holds the commits of the slice above it', async ({
        expect,
        fresh,
      }) => {
        const build = async () => {
          const repo = await fresh()
          await slice(
            repo,
            BOTTOM,
            'main',
            { [STACK_INTENT]: '# Intent\n' },
            { 'src/base.ts': '1\n' },
          )
          await slice(
            repo,
            TOP,
            BOTTOM,
            { 'src/topo.ts': 'x\n' },
            { 'src/topo-2.ts': 'y\n' },
          )
          await slice(
            repo,
            MIDDLE,
            TOP,
            { 'src/meio.ts': 'x\n' },
            { 'src/meio-2.ts': 'y\n' },
          )
          await mergeIntoMain(repo, BOTTOM)
          return repo
        }
        const { result } = await ciAt(await build(), MIDDLE, sliceCi(MIDDLE))
        expect(step(result, 'stacked')).toMatchObject({ status: 'no' })
        expect(step(result, 'stacked').detail).toContain(TOP)
        const control = await ciAt(
          await build(),
          MIDDLE,
          sliceCi(
            MIDDLE,
            {},
            parentAnswer({ body: parentBody([BOTTOM, MIDDLE]) }),
          ),
        )
        expect(step(control.result, 'stacked')).toMatchObject({ status: 'no' })
      })

      test('keeps a slice above exempt while it has not yet merged this slice’s latest commit', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await repo.git('switch', '-q', MIDDLE)
        await repo.commit(
          { 'src/meio-3.ts': 'z\n' },
          'Corrige a fatia do meio (Refs #44)',
        )
        await repo.publish(MIDDLE)
        const { result } = await onSlice(repo, MIDDLE)
        expect(step(result, 'stacked')).toMatchObject({ status: 'ok' })
        expect(step(result, 'commits-cite-issue').detail).toBe(
          '3 commit(s) próprio(s), todos citam #44',
        )
      })

      // A slice above is exempt only when it forks from this slice's own
      // line: an empty list proves nothing. One that forks from a slice below
      // or from main shares nothing of this slice, and is no stacking here.
      test('takes a slice above cut from a slice below, or from main, as sharing nothing of this one', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const recutTop = async (from: string) => {
          await repo.git('switch', '-q', MIDDLE)
          await repo.git('branch', '-f', TOP, from)
          await repo.git('switch', '-q', TOP)
          await repo.commit({ 'src/topo.ts': 'y\n' }, 'Topo (Refs #45)')
          await repo.publish(TOP)
        }
        for (const from of [BOTTOM, 'main']) {
          await recutTop(from)
          const { result } = await onSlice(repo, MIDDLE)
          expect(step(result, 'stacked'), from).toMatchObject({
            status: 'ok',
          })
        }
      })

      // A suggestion applied on GitHub makes a commit that cites nothing. On
      // the first slice, commits-cite-issue only reports it, and the slice
      // above that brings it up must not deadlock the slice below.
      test('lets a slice below open when the slice above brought up a commit of it that cites nothing', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        for (const [lower, upper] of [
          [BOTTOM, MIDDLE],
          [MIDDLE, TOP],
        ]) {
          await repo.git('switch', '-q', lower)
          await repo.commit(
            { [`src/sugestao-${numberOf(lower)}.ts`]: 'x\n' },
            'Apply suggestions from code review',
          )
          await repo.publish(lower)
          await repo.git('switch', '-q', upper)
          await repo.git(
            'merge',
            '-q',
            '--no-ff',
            '-m',
            `Traz a fatia de baixo (Refs #${numberOf(upper)})`,
            lower,
          )
          await repo.publish(upper)
          const { result } = await onSlice(repo, lower)
          expect(step(result, 'stacked'), lower).toMatchObject({
            status: 'ok',
          })
          expect(step(result, 'commits-cite-issue').blocks, lower).toBe(false)
        }
        const inCi = await ciOnSlice(repo, MIDDLE, (head) =>
          slicePr(head, MIDDLE, { baseRefName: BOTTOM, isDraft: true }),
        )
        expect(step(inCi.result, 'stacked')).toMatchObject({ status: 'ok' })
      })

      test('lets a slice open when the slice above was cut from it before its first commit', async ({
        expect,
        fresh,
      }) => {
        const repo = await fresh()
        await slice(
          repo,
          BOTTOM,
          'main',
          { [STACK_INTENT]: '# Intent\n' },
          { 'src/base.ts': '1\n' },
        )
        await repo.git('switch', '-q', '-c', MIDDLE, BOTTOM)
        await repo.publish(MIDDLE)
        await repo.git('switch', '-q', '-c', TOP, MIDDLE)
        await repo.commit({ 'src/topo.ts': 'x\n' }, 'Topo (Refs #45)')
        await repo.publish(TOP)
        const { result } = await onSlice(repo, MIDDLE)
        expect(step(result, 'stacked')).toMatchObject({ status: 'ok' })
      })

      // The slice above brings the slice below, never the other way: a merge
      // of it into the slice below is a merge from outside, and a
      // fast-forward to it brings commits citing its sub-issue.
      test('refuses a slice below that merged or fast-forwarded to the slice above', async ({
        expect,
        fresh,
      }) => {
        const merged = await stack(fresh)
        await merged.git('switch', '-q', TOP)
        await merged.commit({ 'src/topo-2.ts': 'x\n' }, 'Sem número')
        await merged.publish(TOP)
        await merged.git('switch', '-q', MIDDLE)
        await merged.git('merge', '-q', '--no-ff', '-m', 'Traz a de cima', TOP)
        await merged.publish(MIDDLE)
        const upward = await onSlice(merged, MIDDLE)
        expect(step(upward.result, 'stacked')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(upward.result, 'stacked').detail).toContain(
          `a fatia de cima ${TOP} divide com esta commits que não saíram desta: a de cima traz esta (git merge origin/${MIDDLE} nela), nunca o contrário`,
        )
        const forward = await stack(fresh)
        await forward.git('switch', '-q', MIDDLE)
        await forward.git('merge', '-q', '--ff-only', TOP)
        await forward.publish(MIDDLE)
        const fast = await onSlice(forward, MIDDLE)
        expect(step(fast.result, 'stacked')).toMatchObject({
          status: 'no',
          blocks: true,
        })
      })

      test('tells a slice above the first to recut from the slice below, not from main', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await slice(
          repo,
          'feature/61-lado',
          'main',
          { 'src/lado.ts': 'x\n' },
          { 'src/lado-2.ts': 'y\n' },
        )
        await repo.git('switch', '-q', MIDDLE)
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          'Traz outra branch (Refs #44)',
          'feature/61-lado',
        )
        await repo.git('branch', '-q', '-D', 'feature/61-lado')
        await repo.git(
          'update-ref',
          '-d',
          'refs/remotes/origin/feature/61-lado',
        )
        const { result } = await repo.gateJson([], {
          fixture: { issue: sliceAnswer(MIDDLE), parent: parentAnswer() },
        })
        expect(step(result, 'stacked')).toMatchObject({ status: 'no' })
        expect(step(result, 'stacked').detail).toContain(
          `corte a fatia de novo a partir de origin/${BOTTOM} atualizado e traga para ela só os commits dela`,
        )
        expect(step(result, 'stacked').detail).not.toContain(
          'corte a branch de origin/main',
        )
      })

      // GitHub links closing keywords only on a PR to the default branch: a
      // slice's draft on the slice below has no link until it points at main.
      test('reads the closing keywords from the body of a slice PR on the slice below', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const unlinked = { totalCount: 0, nodes: [] }
        const draft = await ciOnSlice(repo, MIDDLE, (head) =>
          slicePr(head, MIDDLE, {
            baseRefName: BOTTOM,
            isDraft: true,
            closingIssuesReferences: unlinked,
          }),
        )
        expect(draft.result.blocked).toEqual([])
        expect(step(draft.result, 'pr-closes').detail).toBe(
          'a PR fecha a #44 (pelo corpo: com a base na fatia de baixo, o GitHub ainda não liga a PR à issue)',
        )
        // A CI run leaves no local branch behind: each run gets a stack.
        const other = await ciOnSlice(await stack(fresh), MIDDLE, (head) =>
          slicePr(head, MIDDLE, {
            baseRefName: BOTTOM,
            isDraft: true,
            closingIssuesReferences: unlinked,
            body: 'Closes #44.\n\nTambém fixes #99.',
          }),
        )
        expect(step(other.result, 'pr-closes-only')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        // On main, only GitHub's link counts, and the message says why it
        // may be missing.
        const onMain = await stack(fresh)
        await mergeIntoMain(onMain, BOTTOM)
        const retargeted = await ciOnSlice(
          onMain,
          MIDDLE,
          (head) =>
            slicePr(head, MIDDLE, { closingIssuesReferences: unlinked }),
          parentAfter([BOTTOM]),
        )
        expect(step(retargeted.result, 'pr-closes')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(retargeted.result, 'pr-closes').detail).toContain(
          'o corpo fecha a #44, mas o GitHub ainda não ligou a PR a nenhuma issue',
        )
      })

      test('judges a Stack at the heading level of a plan from an issue form', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        // The form renders each field as ###, and a heading inside a field
        // is ####, as the form itself says.
        const formPlan = `${featureBody({ Plano: 'As fatias estão abaixo.' }).replace(/^## /gm, '### ')}\n#### Stack\n\n1. \`${BOTTOM}\`\n2. \`${MIDDLE}\`\n3. \`${TOP}\`\n`
        const { result } = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({ body: formPlan }),
        )
        expect(step(result, 'branch-in-plan')).toMatchObject({ status: 'ok' })
        expect(step(result, 'branch-in-plan').detail).toContain('fatia 2 de 3')
      })

      test('suggests more slices, not a stack, for a slice past the size reference', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const { result } = await ciOnSlice(repo, MIDDLE, (head) =>
          slicePr(head, MIDDLE, {
            baseRefName: BOTTOM,
            isDraft: true,
            additions: 1600,
            deletions: 0,
          }),
        )
        expect(step(result, 'pr-size').detail).toContain(
          'considere dividir esta fatia em mais fatias',
        )
      })

      test('refuses a slice above that git cannot compare with this one, instead of exempting it', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        // The slice above has not merged this slice's latest commit yet, so
        // only a comparison with it could exempt it.
        await repo.git('switch', '-q', MIDDLE)
        await repo.commit(
          { 'src/meio-3.ts': 'z\n' },
          'Corrige a fatia do meio (Refs #44)',
        )
        await repo.publish(MIDDLE)
        const top = await repo.git('rev-parse', TOP)
        const { result } = await repo.gateJson([], {
          fixture: { issue: sliceAnswer(MIDDLE), parent: parentAnswer() },
          pathOverride: await pathFailingMergeBase(repo, top),
        })
        expect(step(result, 'stacked')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'stacked').detail).toContain(
          `o git não conseguiu comparar ${TOP}, origin/${TOP} com o HEAD`,
        )
        expect(result.open).toBe(false)
      })

      test('keeps the slices in place when a note before or after the list names another branch', async ({
        expect,
        fresh,
      }) => {
        const before = await stackWithoutIntent(fresh)
        const leading = parentBody().replace(
          'De baixo para cima:\n\n',
          'Depende de:\n\n- `feature/30-algo`, já mergeada em main.\n\nDe baixo para cima:\n\n',
        )
        const first = await ciAt(
          before,
          BOTTOM,
          sliceCi(BOTTOM, {}, parentAnswer({ body: leading })),
        )
        expect(step(first.result, 'branch-in-plan').detail).toContain(
          'fatia 1 de 3',
        )
        expect(step(first.result, 'intent-first')).toMatchObject({
          blocks: true,
        })
        const after = await stack(fresh, '# Changelog\n')
        await mergeIntoMain(after, BOTTOM)
        await mergeIntoMain(after, MIDDLE)
        const trailing = `${parentBody()}\nNotas:\n\n- a \`feature/39-antiga\` não entra na stack.\n`
        const last = await ciAt(
          after,
          TOP,
          sliceCi(TOP, {}, parentAnswer({ body: trailing })),
        )
        expect(step(last.result, 'branch-in-plan').detail).toContain(
          'fatia 3 de 3',
        )
        expect(step(last.result, 'learn')).toMatchObject({
          status: 'no',
          blocks: true,
        })
      })

      /** The middle slice cut from `feature/39-antiga`, a lane the plan's prose excludes. */
      const middleOverExcluded = async (fresh: Fresh) => {
        const repo = await fresh()
        await slice(
          repo,
          BOTTOM,
          'main',
          { [STACK_INTENT]: '# Intent\n' },
          { 'src/base.ts': '1\n' },
        )
        await slice(
          repo,
          'feature/39-antiga',
          BOTTOM,
          { 'src/antiga.ts': 'x\n' },
          { 'src/antiga-2.ts': 'y\n' },
        )
        await slice(
          repo,
          MIDDLE,
          'feature/39-antiga',
          { 'src/meio.ts': 'x\n' },
          { 'src/meio-2.ts': 'y\n' },
        )
        return repo
      }

      test('never exempts a lane that a note in the plan’s prose mentions', async ({
        expect,
        fresh,
      }) => {
        const notes = [
          parentBody(),
          `${parentBody()}\nNotas:\n\n- a \`feature/39-antiga\` não entra na stack.\n`,
          parentBody().replace(
            'De baixo para cima:\n\n',
            'Não usar:\n\n- a `feature/39-antiga`, abandonada.\n\nDe baixo para cima:\n\n',
          ),
        ]
        for (const body of notes) {
          const repo = await middleOverExcluded(fresh)
          const { result } = await onSlice(
            repo,
            MIDDLE,
            sliceAnswer(MIDDLE),
            parentAnswer({ body }),
          )
          expect(step(result, 'stacked')).toMatchObject({ status: 'no' })
          expect(step(result, 'stacked').detail).toContain('feature/39-antiga')
        }
      })

      test('reads the Stack of the current plan only', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const earlier = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            comments: [
              comment(
                `# Plano\n\n${featureBody({ Plano: 'Sem stack.' })}`,
                at('11:00'),
              ),
              approve(),
            ],
          }),
        )
        expect(step(earlier.result, 'branch-in-plan').detail).toContain(
          'não tem a seção Stack',
        )
        const current = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            body: featureBody({ Plano: 'Sem stack no corpo.' }),
            comments: [
              comment(`# Plano\n\n${parentBody()}`, at('11:00')),
              approve(),
            ],
          }),
        )
        expect(step(current.result, 'branch-in-plan')).toMatchObject({
          status: 'ok',
        })
        expect(current.result.open).toBe(true)
      })

      test('leaves the verdict unverified, and warns, when the parent could not be read', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const { result } = await onSlice(
          repo,
          BOTTOM,
          sliceAnswer(BOTTOM),
          failing('unreachable', PARENT),
        )
        expect(result.verified).toBe(false)
        expect(
          gateStatus((await readCache(repo)) as unknown as GateCache, {
            branch: BOTTOM,
          }).state,
        ).toBe('unverified')
        await repo.git('switch', '-q', BOTTOM)
        const run = await repo.gate([], {
          fixture: {
            issue: sliceAnswer(BOTTOM),
            parent: failing('unreachable', PARENT),
          },
        })
        expect(run.out).toContain(
          `Aviso: a mãe #${PARENT} não foi lida (GitHub inacessível)`,
        )
      })

      test('fails closed when the parent is refused, missing, or unread in CI', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const auth = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          failing('auth', PARENT),
        )
        expect(auth.result.open).toBe(false)
        expect(auth.result.verified).toBe(false)
        for (const id of [
          'state-label',
          'sections',
          'criteria',
          'approve',
          'branch-in-plan',
        ])
          expect(step(auth.result, id)).toMatchObject({
            status: 'no',
            blocks: true,
          })
        const missing = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          failing('missing', PARENT),
        )
        expect(step(missing.result, 'state-label').detail).toContain(
          `a mãe #${PARENT} da fatia #44 não existe`,
        )
        // Whatever the failure, a parent not read is not verified, as an
        // issue not read is not.
        expect(missing.result.verified).toBe(false)
        expect(
          gateStatus((await readCache(repo)) as unknown as GateCache, {
            branch: MIDDLE,
          }).state,
        ).toBe('unverified')
        // An answer that does not say the parent's repository is read in part.
        const unnamed = sliceAnswer(MIDDLE, { parent: PARENT })
        delete (
          unnamed.data as {
            repository: { issue: { parent: { repository?: unknown } } }
          }
        ).repository.issue.parent.repository
        const noRepo = await onSlice(repo, MIDDLE, unnamed, undefined)
        expect(step(noRepo.result, 'state-label').detail).toBe(
          `o GitHub não disse de que repositório é a mãe #${PARENT} da fatia #44`,
        )
        expect(noRepo.result.verified).toBe(false)
        const inCi = await stack(fresh)
        const unreachable = await ciAt(inCi, BOTTOM, (head) => ({
          issue: sliceAnswer(BOTTOM),
          parent: failing('unreachable', PARENT),
          pr: slicePr(head, BOTTOM),
        }))
        expect(unreachable.result.blocked).toEqual(
          expect.arrayContaining([
            'state-label',
            'sections',
            'criteria',
            'approve',
            'branch-in-plan',
          ]),
        )
      })

      test('refuses a parent in another repository', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const { result } = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE, { parentRepo: 'alguem/outro' }),
          undefined,
        )
        expect(step(result, 'state-label')).toMatchObject({ status: 'no' })
        expect(step(result, 'state-label').detail).toContain(
          `a mãe da fatia #44 é alguem/outro#${PARENT}, de outro repositório`,
        )
        expect(result.open).toBe(false)
      })

      test('refuses every label trick on the slice and on the parent', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const cases: [string, GhAnswer, GhAnswer][] = [
          [
            'slice also in needs-triage',
            sliceAnswer(MIDDLE, {
              labels: ['enhancement', 'stack-slice', 'needs-triage'],
            }),
            parentAnswer(),
          ],
          [
            'slice labels on a partial page',
            sliceAnswer(MIDDLE, { labelsTotal: 3 }),
            parentAnswer(),
          ],
          [
            'parent labels on a partial page',
            sliceAnswer(MIDDLE),
            parentAnswer({ labelsTotal: 3 }),
          ],
          [
            'parent with two state labels',
            sliceAnswer(MIDDLE),
            parentAnswer({
              labels: ['enhancement', 'ready-for-human', 'ready-for-agent'],
            }),
          ],
          [
            'parent itself a slice',
            sliceAnswer(MIDDLE),
            parentAnswer({ labels: ['enhancement', 'stack-slice'] }),
          ],
          [
            'parent ready label by another user',
            sliceAnswer(MIDDLE),
            parentAnswer({
              events: [
                ...defaultEvents(),
                labeled('ready-for-agent', at('12:30'), {
                  __typename: 'User',
                  login: 'outra-pessoa',
                }),
              ],
            }),
          ],
        ]
        for (const [name, issue, parent] of cases) {
          const { result } = await onSlice(repo, MIDDLE, issue, parent)
          expect(result.open, name).toBe(false)
        }
      })

      test('refuses a copy of a slice below kept under another remote', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await repo.git('switch', '-q', BOTTOM)
        await repo.commit(
          { 'src/alheio.ts': 'x\n' },
          'Trabalho alheio (Refs #99)',
        )
        await repo.git('update-ref', `refs/remotes/upstream/${BOTTOM}`, 'HEAD')
        await repo.git('reset', '-q', '--hard', 'HEAD~1')
        await repo.git('switch', '-q', MIDDLE)
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          'Traz a fatia de baixo (Refs #44)',
          `refs/remotes/upstream/${BOTTOM}`,
        )
        const { result } = await onSlice(repo, MIDDLE)
        expect(step(result, 'stacked')).toMatchObject({ status: 'no' })
        expect(step(result, 'stacked').detail).toContain(`upstream/${BOTTOM}`)
      })

      test('refuses as a base a slice above, or a slice below that is not the one right below', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const upper = await ciAt(
          repo,
          MIDDLE,
          sliceCi(MIDDLE, { baseRefName: TOP, isDraft: true }),
        )
        expect(step(upper.result, 'pr-base')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        const other = await stack(fresh)
        const bottom = await ciAt(
          other,
          BOTTOM,
          sliceCi(BOTTOM, { baseRefName: MIDDLE, isDraft: true }),
        )
        expect(step(bottom.result, 'pr-base')).toMatchObject({
          status: 'no',
          blocks: true,
        })
      })

      test('holds both the intent and the Learn in a stack of one slice', async ({
        expect,
        fresh,
      }) => {
        const repo = await fresh()
        await slice(
          repo,
          BOTTOM,
          'main',
          { [STACK_INTENT]: '# Intent\n' },
          {
            [CHANGELOG]:
              '# Changelog\n\n## 2026-09-20: Só a fatia (#43)\n\nx\n',
          },
        )
        const { result } = await ciAt(
          repo,
          BOTTOM,
          sliceCi(BOTTOM, {}, parentAnswer({ body: parentBody([BOTTOM]) })),
        )
        expect(step(result, 'intent-first')).toMatchObject({
          status: 'ok',
          blocks: true,
        })
        expect(step(result, 'learn')).toMatchObject({
          status: 'no',
          blocks: true,
        })
      })

      test('refuses a Stack with two branches of one issue, or with the parent’s own branch', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const twice = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            body: parentBody([BOTTOM, 'feature/44-outra', MIDDLE, TOP]),
          }),
        )
        expect(step(twice.result, 'branch-in-plan')).toMatchObject({
          status: 'no',
        })
        expect(step(twice.result, 'branch-in-plan').detail).toContain(
          'duas branches da #44',
        )
        const parentOwn = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            body: parentBody([`feature/${PARENT}-a-mae`, BOTTOM, MIDDLE, TOP]),
          }),
        )
        expect(step(parentOwn.result, 'branch-in-plan').detail).toContain(
          `uma branch da própria mãe #${PARENT}`,
        )
        expect(parentOwn.result.open).toBe(false)
      })

      test('refuses a slice after every revocation of the parent’s Approve', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const variants: [string, IssueOptions][] = [
          [
            'reopened after the Approve',
            { events: [...defaultEvents(), reopened(at('12:10'))] },
          ],
          [
            'Approve withdrawn',
            {
              comments: [
                approve(),
                comment('# Approve retirado\n\nNão.', at('12:30')),
              ],
            },
          ],
          [
            'near-miss heading',
            {
              comments: [
                approve(),
                comment('## Approve retirado\n\nNão.', at('12:30')),
              ],
            },
          ],
          [
            'comment deleted',
            { events: [...defaultEvents(), deleted(at('12:30'))] },
          ],
          [
            'older comment edited',
            {
              comments: [
                comment('Um comentário.', at('11:00'), {
                  lastEditedAt: at('12:30'),
                }),
                approve(),
              ],
            },
          ],
          ['body edited', { lastEditedAt: at('12:30') }],
          [
            'new # Plano',
            {
              comments: [
                approve(),
                comment(`# Plano\n\n${parentBody()}`, at('12:30')),
              ],
            },
          ],
          [
            'ready label before the Approve',
            {
              events: [
                labeled('enhancement', at('10:00')),
                labeled('ready-for-agent', at('11:00')),
              ],
            },
          ],
          [
            'Approve by another user',
            {
              comments: [
                approve(at('12:00'), {
                  author: { __typename: 'User', login: 'outra-pessoa' },
                }),
              ],
            },
          ],
        ]
        for (const [name, options] of variants) {
          const { result } = await onSlice(
            repo,
            MIDDLE,
            sliceAnswer(MIDDLE),
            parentAnswer(options),
          )
          expect(step(result, 'approve').status, name).toBe('no')
          expect(result.open, name).toBe(false)
        }
      })

      test('judges a sub-issue by its own parent, not by another plan whose Stack names it', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const slicesOf50 = SLICES.map((branch) => ({
          number: numberOf(branch),
        }))
        const other = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE, { parent: 50 }),
          issueAnswer({
            number: 50,
            body: parentBody([BOTTOM, TOP]),
            subIssues: slicesOf50,
          }),
        )
        expect(step(other.result, 'branch-in-plan')).toMatchObject({
          status: 'no',
        })
        expect(step(other.result, 'branch-in-plan').detail).toContain(
          `não cita a branch ${MIDDLE}`,
        )
        const listed = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE, { parent: 50 }),
          issueAnswer({
            number: 50,
            body: parentBody(),
            subIssues: slicesOf50,
          }),
        )
        expect(step(listed.result, 'branch-in-plan').detail).toContain(
          'mãe #50',
        )
        expect(listed.result.open).toBe(true)
      })

      // A branch the Stack names below this slice is taken as its base and
      // kept out of its own commits, so it must be a slice of this parent.
      test('refuses a Stack that names a branch outside the parent’s slices, and the base that branch would give', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        // A branch of another issue, where the slice below would be.
        await repo.git('branch', '-q', 'feature/99-alheia', BOTTOM)
        await repo.publish('feature/99-alheia')
        const outsider = parentAnswer({
          body: parentBody(['feature/99-alheia', MIDDLE, TOP]),
          subIssues: [MIDDLE, TOP].map((branch) => ({
            number: numberOf(branch),
          })),
        })
        const { result } = await ciOnSlice(
          repo,
          MIDDLE,
          (head) =>
            slicePr(head, MIDDLE, {
              baseRefName: 'feature/99-alheia',
              isDraft: true,
            }),
          outsider,
        )
        expect(step(result, 'branch-in-plan')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'branch-in-plan').detail).toContain(
          `a seção Stack cita feature/99-alheia, mas a #99 não é sub-issue da mãe #${PARENT} neste repositório: toda branch da Stack é de uma fatia da mãe`,
        )
        expect(step(result, 'pr-base')).toMatchObject({ status: 'no' })
        expect(result.blocked).toEqual(
          expect.arrayContaining(['branch-in-plan', 'pr-base']),
        )
      })

      test('refuses a Stack whose branches are not all slices of the parent, read whole', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const rest = [{ number: 44 }, { number: 45 }]
        const cases: [string, IssueOptions, string][] = [
          [
            'a sub-issue without the slice label',
            {
              subIssues: [
                { number: 43, labels: ['enhancement', 'ready-for-agent'] },
                ...rest,
              ],
            },
            `a seção Stack cita ${BOTTOM}, mas a #43 não tem a label stack-slice`,
          ],
          [
            'a sub-issue in another repository',
            { subIssues: [{ number: 43, repo: 'alguem/outro' }, ...rest] },
            `a seção Stack cita ${BOTTOM}, mas a #43 não é sub-issue da mãe #${PARENT} neste repositório`,
          ],
          [
            'a sub-issue whose labels were read in part',
            { subIssues: [{ number: 43, labelsTotal: 101 }, ...rest] },
            `a seção Stack cita ${BOTTOM}, e as labels da #43 não foram lidas inteiras`,
          ],
          [
            'more sub-issues than one page',
            { subIssuesTotal: 101 },
            `a mãe #${PARENT} tem 101 sub-issues e o gate leu 3: ele não julga a seção Stack sem ler todas`,
          ],
        ]
        for (const [name, options, problem] of cases) {
          const { result } = await onSlice(
            repo,
            MIDDLE,
            sliceAnswer(MIDDLE),
            parentAnswer(options),
          )
          expect(step(result, 'branch-in-plan').status, name).toBe('no')
          expect(step(result, 'branch-in-plan').detail, name).toContain(problem)
          expect(result.open, name).toBe(false)
        }
      })

      test('turns the slice below red when a slice above is merged into it', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await repo.git('switch', '-q', MIDDLE)
        await repo.git(
          'merge',
          '-q',
          '--no-ff',
          '-m',
          'Merge da fatia de cima',
          TOP,
        )
        await repo.publish(MIDDLE)
        const { result } = await onSlice(repo, MIDDLE)
        expect(step(result, 'stacked')).toMatchObject({ status: 'no' })
      })

      test('does not judge the Approve of a parent with more comments than a page', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const { result } = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({ commentsTotal: 101 }),
        )
        expect(step(result, 'approve')).toMatchObject({ status: 'no' })
        expect(step(result, 'approve').detail).toContain(`(na mãe #${PARENT})`)
      })

      test('judges a bug parent’s plan with the bug sections', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const body = `${bugBody('feature/99-x')}\n\n## Stack\n\n1. \`${BOTTOM}\`\n2. \`${MIDDLE}\`\n3. \`${TOP}\`\n`
        const { result } = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            body,
            labels: ['bug', 'ready-for-agent'],
            events: [
              labeled('bug', at('10:00')),
              labeled('ready-for-agent', at('12:05')),
            ],
          }),
        )
        expect(step(result, 'sections')).toMatchObject({ status: 'ok' })
        expect(step(result, 'sections').detail).toContain('seções de bug')
        expect(step(result, 'kind')).toMatchObject({
          status: 'ok',
          detail: `enhancement (a mãe #${PARENT} é bug)`,
        })
      })

      test('refuses a slice whose parent has no category, or more than one', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const none = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            labels: ['ready-for-agent'],
            events: [labeled('ready-for-agent', at('12:05'))],
          }),
        )
        expect(step(none.result, 'kind')).toMatchObject({
          status: 'no',
          blocks: true,
          detail: `na mãe #${PARENT}, nenhuma label de categoria (bug ou enhancement)`,
        })
        expect(none.result.open).toBe(false)
        const two = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({
            labels: ['bug', 'enhancement', 'ready-for-agent'],
            events: [
              labeled('bug', at('10:00')),
              labeled('enhancement', at('10:00')),
              labeled('ready-for-agent', at('12:05')),
            ],
          }),
        )
        expect(step(two.result, 'kind')).toMatchObject({
          status: 'no',
          detail: `na mãe #${PARENT}, mais de uma label de categoria: bug, enhancement`,
        })
        expect(two.result.open).toBe(false)
        const partial = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({ labelsTotal: 3 }),
        )
        expect(step(partial.result, 'kind')).toMatchObject({ status: 'no' })
        expect(step(partial.result, 'kind').detail).toContain(
          `na mãe #${PARENT}, a issue tem 3 labels e o gate leu 2`,
        )
      })

      test('refuses a parent that is a slice too, with a state label of its own or without one', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        for (const labels of [
          ['enhancement', 'stack-slice', 'ready-for-agent'],
          ['enhancement', 'stack-slice'],
        ]) {
          const { result } = await onSlice(
            repo,
            MIDDLE,
            sliceAnswer(MIDDLE),
            parentAnswer({ labels }),
          )
          expect(result.open, labels.join(', ')).toBe(false)
          for (const id of [
            'state-label',
            'sections',
            'criteria',
            'approve',
            'branch-in-plan',
          ])
            expect(
              step(result, id),
              `${labels.join(', ')}: ${id}`,
            ).toMatchObject({
              status: 'no',
              blocks: true,
              detail: `a mãe #${PARENT} da fatia #44 também tem a label stack-slice: uma stack não se aninha, e a mãe de uma fatia é a raiz da stack`,
            })
        }
      })

      test('refuses every slice of a Stack with a problem', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const twice = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({ body: parentBody([BOTTOM, MIDDLE, TOP, BOTTOM]) }),
        )
        expect(step(twice.result, 'branch-in-plan')).toMatchObject({
          status: 'no',
        })
        const pair = parentBody().replace(
          `2. \`${MIDDLE}\``,
          `2. \`${MIDDLE}\` (antes \`feature/44-velha\`)`,
        )
        const two = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE),
          parentAnswer({ body: pair }),
        )
        expect(step(two.result, 'branch-in-plan')).toMatchObject({
          status: 'no',
        })
      })

      // A missing ref, or one still at main, proves nothing about a slice
      // below: its sub-issue closed, as its PR leaves it on merge, does.
      test('refuses a slice on main while a slice below is open, whatever its ref shows', async ({
        expect,
        fresh,
      }) => {
        // The first slice published before its first commit.
        const empty = await fresh()
        await empty.git('switch', '-q', '-c', BOTTOM, 'main')
        await empty.publish(BOTTOM)
        await slice(
          empty,
          MIDDLE,
          BOTTOM,
          { 'src/meio.ts': 'x\n' },
          { 'src/meio-2.ts': 'y\n' },
        )
        const early = await ciAt(empty, MIDDLE, sliceCi(MIDDLE))
        expect(step(early.result, 'pr-base')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(early.result, 'pr-base').detail).toContain(
          `a fatia de baixo ${BOTTOM} ainda não foi mergeada em main`,
        )
        // The first slice's ref deleted without a merge.
        const gone = await fresh()
        await slice(
          gone,
          BOTTOM,
          'main',
          { [STACK_INTENT]: '# Intent\n' },
          { 'src/base.ts': '1\n' },
        )
        await slice(
          gone,
          MIDDLE,
          'main',
          { 'src/meio.ts': 'x\n' },
          { 'src/meio-2.ts': 'y\n' },
        )
        await gone.git('update-ref', '-d', `refs/remotes/origin/${BOTTOM}`)
        const deleted = await ciAt(gone, MIDDLE, sliceCi(MIDDLE))
        expect(step(deleted.result, 'pr-base')).toMatchObject({ status: 'no' })
        expect(step(deleted.result, 'pr-base').detail).toContain(BOTTOM)
      })

      // Reopening resets the Approve on any issue. A slice has no Approve of
      // its own, so its acts count against its parent's, for this slice.
      test('counts the slice’s own reopening, withdrawal and revision against the parent’s Approve', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        const sliceEvents = [
          labeled('enhancement', at('10:00')),
          labeled('stack-slice', at('10:00')),
        ]
        const reopenedSlice = sliceAnswer(MIDDLE, {
          events: [...sliceEvents, reopened(at('14:00'))],
        })
        const stale = await onSlice(repo, MIDDLE, reopenedSlice)
        expect(step(stale.result, 'approve')).toMatchObject({
          status: 'no',
          blocks: true,
          detail: `a fatia #44 foi reaberta em ${at('14:00')}, depois do Approve da mãe #${PARENT}: reabrir zera o Approve, e vale para ela um Approve novo na mãe, com ready-for-agent aplicada de novo`,
        })
        expect(stale.result.open).toBe(false)
        const renewed = await onSlice(
          repo,
          MIDDLE,
          reopenedSlice,
          parentAnswer({
            comments: [approve(), approve(at('15:00'))],
            events: [
              ...defaultEvents(),
              labeled('ready-for-agent', at('15:05')),
            ],
          }),
        )
        expect(step(renewed.result, 'approve').status).toBe('ok')
        for (const [name, body] of [
          ['a withdrawal', '# Approve retirado\n\nPare esta fatia.'],
          ['a revision', '# Plano\n\nOutra fatia.'],
          ['a title naming Approve', '## Approve da fatia\n\nOk.'],
        ]) {
          const { result } = await onSlice(
            repo,
            MIDDLE,
            sliceAnswer(MIDDLE, { comments: [comment(body, at('13:00'))] }),
          )
          expect(step(result, 'approve').status, name).toBe('no')
          expect(step(result, 'approve').detail, name).toContain(
            `(na mãe #${PARENT} e na fatia #44)`,
          )
        }
        const edited = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE, {
            comments: [
              comment('Nota.', at('11:00'), { lastEditedAt: at('13:00') }),
            ],
          }),
        )
        expect(step(edited.result, 'approve').status).toBe('no')
        // An Approve written on the slice neither approves nor revokes.
        const own = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE, { comments: [approve(at('13:00'))] }),
        )
        expect(step(own.result, 'approve').status).toBe('ok')
        const onlyOwn = await onSlice(
          repo,
          MIDDLE,
          sliceAnswer(MIDDLE, { comments: [approve(at('13:00'))] }),
          parentAnswer({ comments: [] }),
        )
        expect(step(onlyOwn.result, 'approve').status).toBe('no')
      })

      test('refuses a slice whose own commits git cannot walk', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await mergeIntoMain(repo, BOTTOM)
        await repo.git('switch', '-q', MIDDLE)
        await repo.commit(
          { 'src/alheio.ts': 'x\n' },
          'Trabalho de outra issue (Refs #99)',
        )
        await repo.publish(MIDDLE)
        const { result } = await ciAt(
          repo,
          MIDDLE,
          sliceCi(MIDDLE, {}, parentAfter([BOTTOM])),
          await pathFailingFirstParentWalk(repo),
        )
        expect(step(result, 'stacked')).toMatchObject({
          status: 'no',
          blocks: true,
        })
        expect(step(result, 'stacked').detail).toContain(
          'o git não conseguiu ler os commits próprios desta branch',
        )
        expect(result.open).toBe(false)
      })

      test('lets a slice on main once the slices below are merged', async ({
        expect,
        fresh,
      }) => {
        const repo = await stack(fresh)
        await mergeIntoMain(repo, BOTTOM)
        const { result } = await ciAt(
          repo,
          MIDDLE,
          sliceCi(MIDDLE, {}, parentAfter([BOTTOM])),
        )
        expect(step(result, 'pr-base')).toMatchObject({ status: 'ok' })
        expect(result.blocked).toEqual([])
        expect(step(result, 'commits-cite-issue').detail).toBe(
          '2 commit(s) próprio(s), todos citam #44',
        )
      })

      test('takes the size reference as inclusive', async ({
        expect,
        fresh,
      }) => {
        const at1500 = await ci(fresh, (head) => ({
          issue: issueAnswer(),
          pr: prAnswer(head, { additions: 1500, deletions: 0 }),
        }))
        expect(step(at1500.result, 'pr-size').status).toBe('ok')
        const at1501 = await ci(fresh, (head) => ({
          issue: issueAnswer(),
          pr: prAnswer(head, { additions: 1500, deletions: 1 }),
        }))
        expect(step(at1501.result, 'pr-size').status).toBe('no')
      })
    },
  )

  describe.concurrent('the fake gh reads the GraphQL', () => {
    /** The shim, called directly with the gate's argv shape and a query. */
    const callFake = async (
      repo: TempRepo,
      query: string,
      issue: IssueOptions = {},
    ) => {
      writeFileSync(
        repo.fixturePath,
        JSON.stringify({ owner: OWNER, name: NAME, issue: issueAnswer(issue) }),
      )
      return exec(
        path.join(repo.bin, 'gh'),
        [
          'api',
          'graphql',
          '-F',
          `owner=${OWNER}`,
          '-F',
          `name=${NAME}`,
          '-F',
          `number=${ISSUE}`,
          '-f',
          `query=${query}`,
        ],
        {
          timeout: 60_000,
          env: repo.env({
            FAKE_GH_LOG: repo.log,
            FAKE_GH_FIXTURE: repo.fixturePath,
            GH_PROMPT_DISABLED: '1',
            GH_NO_UPDATE_NOTIFIER: '1',
          }),
        },
      )
    }
    const header = 'query($owner: String!, $name: String!, $number: Int!)'
    const selection = (issueFields: string) =>
      `${header} { repository(owner: $owner, name: $name) { owner { login } issue(number: $number) { ${issueFields} } } }`
    const complete =
      'state body lastEditedAt parent { number repository { nameWithOwner } } labels(first: 100) { totalCount nodes { name } } comments(last: 100) { totalCount nodes { body createdAt lastEditedAt author { __typename login } } } timelineItems(last: 100, itemTypes: [LABELED_EVENT, REOPENED_EVENT, COMMENT_DELETED_EVENT]) { totalCount nodes { __typename ... on LabeledEvent { createdAt actor { __typename login } label { name } } ... on ReopenedEvent { createdAt } ... on CommentDeletedEvent { createdAt } } } subIssues(first: 100) { totalCount nodes { number state repository { nameWithOwner } labels(first: 100) { totalCount nodes { name } } } }'

    test('refuses a query that does not select lastEditedAt', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      const run = await callFake(
        repo,
        selection(complete.replace('body lastEditedAt', 'body')),
      )
      expect(run.status).toBe(97)
      expect(readFileSync(repo.log, 'utf8')).toContain(
        'repository.issue.lastEditedAt',
      )
    })

    test('answers only the fields a complete query selected', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      // `number` is in the fixture, but this query does not ask for it.
      const run = await callFake(repo, selection(complete))
      expect(run.status).toBe(0)
      const issue = JSON.parse(run.stdout).data.repository.issue
      expect(issue).not.toHaveProperty('number')
      expect(issue).toHaveProperty('lastEditedAt')
      expect(issue.comments.nodes[0].author).toEqual({
        __typename: 'User',
        login: OWNER,
      })
    })

    // As GitHub does: a page holds first or last nodes, and totalCount still
    // counts them all, so a spec can put more on the fixture than a page.
    test('cuts each connection to the page the query asked for', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      const run = await callFake(
        repo,
        selection(
          complete
            .replace('labels(first: 100)', 'labels(first: 2)')
            .replace('comments(last: 100)', 'comments(last: 1)'),
        ),
        {
          labels: ['enhancement', 'ready-for-agent', 'needs-triage'],
          comments: [comment('antes', at('11:00')), approve()],
        },
      )
      expect(run.status).toBe(0)
      const issue = JSON.parse(run.stdout).data.repository.issue
      expect(issue.labels).toEqual({
        totalCount: 3,
        nodes: [{ name: 'enhancement' }, { name: 'ready-for-agent' }],
      })
      expect(issue.comments.totalCount).toBe(2)
      expect(issue.comments.nodes.map((node: Comment) => node.body)).toEqual([
        '# Owner Approve\n\nAprovado, pode seguir.',
      ])
    })

    test.for([
      [
        'no page size',
        'labels(first: 100)',
        'labels',
        'deve pedir first ou last',
      ],
      [
        'both first and last',
        'labels(first: 100)',
        'labels(first: 100, last: 100)',
        'deve pedir first ou last, e só um deles',
      ],
      [
        'a page past 100',
        'labels(first: 100)',
        'labels(first: 101)',
        'repository.issue.labels(first: 101) deve ser um número de 1 a 100',
      ],
      [
        'a page given by a variable',
        'comments(last: 100)',
        'comments(last: $number)',
        'repository.issue.comments(last: $number)',
      ],
    ] as const)(
      'refuses a connection with %s',
      async ([, from, to, named], { expect, fresh }) => {
        const repo = await fresh()
        const run = await callFake(repo, selection(complete.replace(from, to)))
        expect(run.status).toBe(97)
        expect(readFileSync(repo.log, 'utf8')).toContain(named)
      },
    )

    // The gate's own query, edited the way a careless change would: each
    // edit must make the fake refuse, and the case fail, rather than let the
    // gate silently lose a check it still reports.
    test.for([
      [
        'the issue’s lastEditedAt',
        'body lastEditedAt parent',
        'body parent',
        'repository.issue.lastEditedAt',
      ],
      [
        'the parent a slice is judged by',
        'lastEditedAt parent { number repository { nameWithOwner } } labels',
        'lastEditedAt labels',
        'repository.issue.parent',
      ],
      [
        'the repository of the parent',
        'parent { number repository { nameWithOwner } }',
        'parent { number }',
        'repository.issue.parent.repository',
      ],
      [
        'the comments’ lastEditedAt',
        'createdAt lastEditedAt author',
        'createdAt author',
        'comments.nodes.lastEditedAt',
      ],
      [
        'the author’s type',
        'author { __typename login }',
        'author { login }',
        'comments.nodes.author.__typename',
      ],
      [
        'the label actor’s type',
        'actor { __typename login }',
        'actor { login }',
        '... on LabeledEvent.actor.__typename',
      ],
      [
        'the deletion events',
        ', COMMENT_DELETED_EVENT]',
        ']',
        'COMMENT_DELETED_EVENT',
      ],
      [
        'the deletion time',
        ' ... on CommentDeletedEvent { createdAt }',
        '',
        '... on CommentDeletedEvent',
      ],
      [
        'the event type',
        'nodes { __typename ... on',
        'nodes { ... on',
        'timelineItems.nodes.__typename',
      ],
      [
        'the event count',
        '{ totalCount nodes { __typename',
        '{ nodes { __typename',
        'timelineItems.totalCount',
      ],
      [
        'the repository owner',
        'owner { login } issue(',
        'issue(',
        'repository.owner',
      ],
      [
        'the label count',
        '{ totalCount nodes { name } }',
        '{ nodes { name } }',
        'repository.issue.labels.totalCount',
      ],
      [
        'a label page size',
        'labels(first: ${page})',
        'labels',
        'repository.issue.labels deve pedir first ou last',
      ],
      [
        'the sub-issues a Stack is checked against',
        ' subIssues(first: ${page}) { totalCount nodes { number state repository { nameWithOwner } labels(first: ${page}) { totalCount nodes { name } } } }',
        '',
        'repository.issue.subIssues',
      ],
      [
        'the state of a sub-issue',
        'nodes { number state repository',
        'nodes { number repository',
        'subIssues.nodes.state',
      ],
      [
        'the repository of a sub-issue',
        'number state repository { nameWithOwner } labels',
        'number state labels',
        'subIssues.nodes.repository',
      ],
      [
        'the labels of a sub-issue',
        ' labels(first: ${page}) { totalCount nodes { name } } } } } } }',
        ' } } } } }',
        'subIssues.nodes.labels',
      ],
    ] as const)(
      'refuses the issue query without %s',
      async ([, from, to, named], { expect, fresh }) => {
        const repo = await fresh()
        await workBranch(repo)
        mutate(path.join(repo.dir, 'scripts', 'gate.mjs'), from, to)
        await expect(judge(repo)).rejects.toThrow(named)
      },
    )

    test.for([
      [
        'the head commit',
        'headRefName headRefOid isDraft',
        'headRefName isDraft',
        'repository.pullRequest.headRefOid',
      ],
      [
        'the size of the PR',
        'body additions deletions changedFiles closingIssuesReferences',
        'body closingIssuesReferences',
        'repository.pullRequest.additions',
      ],
      [
        'the count of closed issues',
        'closingIssuesReferences(first: 10) { totalCount nodes',
        'closingIssuesReferences(first: 10) { nodes',
        'closingIssuesReferences.totalCount',
      ],
      [
        'the draft flag',
        ' isDraft body',
        ' body',
        'repository.pullRequest.isDraft',
      ],
      [
        'the reviews',
        ' reviews(last: ${page}) { totalCount nodes { state submittedAt commit { oid } author { __typename login ... on Bot { databaseId } } body } }',
        '',
        'repository.pullRequest.reviews',
      ],
      [
        'the review body',
        '{ databaseId } } body } }',
        '{ databaseId } } } }',
        'reviews.nodes.body',
      ],
      [
        'the review count',
        'reviews(last: ${page}) { totalCount nodes',
        'reviews(last: ${page}) { nodes',
        'repository.pullRequest.reviews.totalCount',
      ],
      [
        'the review state',
        'nodes { state submittedAt',
        'nodes { submittedAt',
        'reviews.nodes.state',
      ],
      [
        'the review time',
        'state submittedAt commit',
        'state commit',
        'reviews.nodes.submittedAt',
      ],
      [
        'the reviewed commit',
        'submittedAt commit { oid } author',
        'submittedAt author',
        'reviews.nodes.commit',
      ],
      [
        'the reviewer’s type',
        'author { __typename login ... on Bot',
        'author { login ... on Bot',
        'reviews.nodes.author.__typename',
      ],
      [
        'the reviewer’s database id',
        ' ... on Bot { databaseId }',
        '',
        'reviews.nodes.author.... on Bot',
      ],
      [
        'the review threads',
        ' reviewThreads(first: ${page}) { totalCount nodes { isResolved isOutdated path line comments(first: 1) { nodes { url author { login } } } } }',
        '',
        'repository.pullRequest.reviewThreads',
      ],
      [
        'the thread count',
        'reviewThreads(first: ${page}) { totalCount nodes',
        'reviewThreads(first: ${page}) { nodes',
        'repository.pullRequest.reviewThreads.totalCount',
      ],
      [
        'the thread resolution',
        'nodes { isResolved isOutdated',
        'nodes { isOutdated',
        'reviewThreads.nodes.isResolved',
      ],
      [
        'the outdated flag',
        'isResolved isOutdated path',
        'isResolved path',
        'reviewThreads.nodes.isOutdated',
      ],
      [
        'the thread path',
        'isOutdated path line',
        'isOutdated line',
        'reviewThreads.nodes.path',
      ],
      [
        'the thread line',
        'path line comments',
        'path comments',
        'reviewThreads.nodes.line',
      ],
      [
        'the thread link',
        'nodes { url author { login } }',
        'nodes { author { login } }',
        'reviewThreads.nodes.comments.nodes.url',
      ],
      [
        'the thread opener',
        'nodes { url author { login } }',
        'nodes { url }',
        'reviewThreads.nodes.comments.nodes.author',
      ],
      [
        'a thread page size',
        'reviewThreads(first: ${page})',
        'reviewThreads',
        'repository.pullRequest.reviewThreads deve pedir first ou last',
      ],
      [
        'a review page size',
        'reviews(last: ${page})',
        'reviews',
        'repository.pullRequest.reviews deve pedir first ou last',
      ],
    ] as const)(
      'refuses the PR query without %s',
      async ([, from, to, named], { expect, fresh }) => {
        const repo = await fresh()
        await workBranch(repo)
        await expect(
          ciOver(repo, passingCi, {
            prepare: (script) => mutate(script, from, to),
          }),
        ).rejects.toThrow(named)
      },
    )
  })
})
