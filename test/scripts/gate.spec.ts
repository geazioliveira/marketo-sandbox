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
  ownerRule,
  parseBranch,
  stepIds,
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
  state?: 'OPEN' | 'CLOSED'
  body?: string
  lastEditedAt?: string | null
  labels?: string[]
  comments?: Comment[]
  events?: object[]
  commentsTotal?: number
  eventsTotal?: number
}

function issueAnswer(options: IssueOptions = {}): GhAnswer {
  const comments = options.comments ?? [approve()]
  const events = options.events ?? defaultEvents()
  return {
    number: ISSUE,
    mode: 'ok',
    data: {
      repository: {
        owner: { login: OWNER },
        issue: {
          number: ISSUE,
          state: options.state ?? 'OPEN',
          body: options.body ?? featureBody(),
          lastEditedAt: options.lastEditedAt ?? null,
          labels: {
            nodes: (options.labels ?? ['enhancement', 'ready-for-agent']).map(
              (name) => ({ name }),
            ),
          },
          comments: {
            totalCount: options.commentsTotal ?? comments.length,
            nodes: comments,
          },
          timelineItems: {
            totalCount: options.eventsTotal ?? events.length,
            nodes: events,
          },
        },
      },
    },
  }
}

const closing = (number: number, nameWithOwner = `${OWNER}/${NAME}`) => ({
  number,
  repository: { nameWithOwner },
})

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
          closingIssuesReferences: { totalCount: 1, nodes: [closing(ISSUE)] },
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

/** CI mode over a repository some case has already shaped, on BRANCH. */
async function ciOver(
  repo: TempRepo,
  fixture: (head: string) => GhFixture,
  {
    env = {},
    prepare,
  }: {
    env?: Record<string, string>
    /** Runs on the trusted copy of the gate before it runs. */
    prepare?: (script: string) => void
  } = {},
) {
  const head = await repo.head()
  await repo.git('switch', '-q', '--detach')
  await repo.git('branch', '-q', '-D', BRANCH)
  await repo.git('branch', '-q', '-D', 'main')
  const trusted = installGate(path.join(repo.root, 'trusted'))
  prepare?.(trusted)
  const run = await repo.gateJson(['--pr', String(PR), '--branch', BRANCH], {
    fixture: fixture(head),
    script: trusted,
    env: { GITHUB_REPOSITORY: `${OWNER}/${NAME}`, ...env },
  })
  return { repo, head, ...run }
}

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

const step = (result: GateResult, id: string) => {
  const found = result.steps.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`passo ausente: ${id}`)
  return found
}

const statuses = (result: GateResult) =>
  Object.fromEntries(result.steps.map((entry) => [entry.id, entry.status]))

const localPass = Object.fromEntries(
  stepIds.map((id) => [id, id.startsWith('pr-') ? 'skip' : 'ok']),
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
      const which = await exec('sh', ['-c', 'command -v git'])
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

  describe.concurrent('the fake gh reads the GraphQL', () => {
    /** The shim, called directly with the gate's argv shape and a query. */
    const callFake = async (repo: TempRepo, query: string) => {
      writeFileSync(
        repo.fixturePath,
        JSON.stringify({ owner: OWNER, name: NAME, issue: issueAnswer() }),
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
      'state body lastEditedAt labels(first: 50) { nodes { name } } comments(last: 100) { totalCount nodes { body createdAt lastEditedAt author { __typename login } } } timelineItems(last: 100, itemTypes: [LABELED_EVENT, REOPENED_EVENT, COMMENT_DELETED_EVENT]) { totalCount nodes { __typename ... on LabeledEvent { createdAt actor { __typename login } label { name } } ... on ReopenedEvent { createdAt } ... on CommentDeletedEvent { createdAt } } }'

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

    // The gate's own query, edited the way a careless change would: each
    // edit must make the fake refuse, and the case fail, rather than let the
    // gate silently lose a check it still reports.
    test.for([
      [
        'the issue’s lastEditedAt',
        'body lastEditedAt labels',
        'body labels',
        'repository.issue.lastEditedAt',
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
