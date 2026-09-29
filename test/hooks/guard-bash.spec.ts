import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base } from 'vitest'
import {
  copilotReviewer,
  gateCacheFile,
  gateCacheSchema,
  planPendingFile,
  requiredChecks,
} from '../../scripts/loop-sections.mjs'
import {
  gitShim,
  type HookRepo,
  hookRepo,
  type HookRun,
  runHook,
  setupTimeout,
  processTimeout,
} from '../support/hooks'
import { projectRoot } from '../support/temp-repo'

/**
 * The shell guard (.claude/hooks/guard-bash.mjs), run as Claude Code runs
 * it: a process with the PreToolUse input on stdin, its decision read from
 * stdout. The live reads go to the strict fake gh (fake-gh-hooks.mjs), whose
 * log says whether GitHub was asked at all. The rules themselves are covered
 * case by case in gh-rules.spec.ts and git-rules.spec.ts; here are the
 * paths that only exist end to end: the input, the directory each command
 * runs in, the live reads through a real gh process, the permission modes,
 * the tripwire, and the commands that must pass.
 */

vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })

const FEATURE = 'feature/5-hooks-claude-code'
const HEAD = 'a'.repeat(40)

let feature: HookRepo
let onMain: HookRepo
let elsewhere: HookRepo

beforeAll(async () => {
  // The gate is open on the branch of the issue: a git command that writes
  // the worktree passes there as an edit would (Copilot review of #26,
  // fourth round), and the other rules are judged alone.
  ;[feature, onMain, elsewhere] = await Promise.all([
    hookRepo({ branch: FEATURE, cache: true }),
    hookRepo(),
    hookRepo({ origin: 'https://github.com/alguem/outro.git' }),
  ])
  // Untracked files the cases read: harmless text a line may rewrite.
  feature.write({
    'b-recado.md': 'Recado.\n',
    'msg-ok.txt': 'Hooks\n',
    'reabre.sh': 'gh issue reopen 5\n',
  })
}, setupTimeout)

afterAll(() => {
  for (const repo of [feature, onMain, elsewhere]) repo?.remove()
}, setupTimeout)

interface GhCall {
  argv: string[]
  /** The host the fake gh was asked for, and the GH_HOST and GH_REPO it saw. */
  host?: string
  envHost?: string | null
  envRepo?: string | null
  call?: string
  key?: string
  mode?: string
  violation?: string
  /** The variables that pick gh's account, as the fake gh saw them (ninth round). */
  auth?: Record<string, string | null>
}

interface Live {
  env: NodeJS.ProcessEnv
  calls: () => GhCall[]
}

/**
 * A fixture and a log of their own for each case, over the shared
 * repositories: the cases run concurrently, and each asserts its own log.
 */
const test = base.extend<{
  live: (fixture: unknown, extra?: Record<string, string>) => Live
}>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  live: async ({}, use) => {
    const dirs: string[] = []
    await use((fixture, extra = {}) => {
      const dir = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'guard-bash-')),
      )
      dirs.push(dir)
      const fixturePath = path.join(dir, 'fixture.json')
      const log = path.join(dir, 'gh.log')
      writeFileSync(fixturePath, JSON.stringify(fixture))
      return {
        env: feature.env({
          FAKE_GH_FIXTURE: fixturePath,
          FAKE_GH_LOG: log,
          ...extra,
        }),
        calls: () =>
          existsSync(log)
            ? readFileSync(log, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line) as GhCall)
            : [],
      }
    })
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  },
})

interface GuardOptions {
  repo?: HookRepo
  env?: NodeJS.ProcessEnv
  mode?: string
  tool?: string
  toolInput?: Record<string, unknown>
  input?: Record<string, unknown>
}

/** The hook on one command line, in the repository (feature by default). */
function guard(
  command: unknown,
  {
    repo = feature,
    env,
    mode = 'default',
    tool = 'Bash',
    toolInput = {},
    input = {},
  }: GuardOptions = {},
): Promise<HookRun> {
  return repo.run(
    'guard-bash',
    {
      session_id: 'sessao-1',
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      tool_input: { command, ...toolInput },
      permission_mode: mode,
      ...input,
    },
    { env },
  )
}

const decisionOf = (run: HookRun) =>
  run.json?.hookSpecificOutput?.permissionDecision ?? null
const reasonOf = (run: HookRun) =>
  run.json?.hookSpecificOutput?.permissionDecisionReason ?? ''

function expectPass(run: HookRun) {
  expect(run.status).toBe(0)
  expect(run.stdout).toBe('')
}

function expectDecision(
  run: HookRun,
  decision: 'deny' | 'ask',
  reason?: RegExp | string,
) {
  expect(run.status).toBe(0)
  expect(run.json?.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
  expect(decisionOf(run)).toBe(decision)
  expect(reasonOf(run)).toMatch(/^\[hooks do loop, #5\] /)
  if (reason !== undefined) expect(reasonOf(run)).toMatch(reason)
}

const expectDeny = (run: HookRun, reason?: RegExp | string) =>
  expectDecision(run, 'deny', reason)
const expectAsk = (run: HookRun, reason?: RegExp | string) =>
  expectDecision(run, 'ask', reason)

// ---------------------------------------------------------------------------

describe.concurrent('the input', () => {
  it.each([
    ['not JSON', 'isto não é JSON'],
    ['a JSON array', '[1, 2]'],
    ['empty', ''],
  ])('denies an input that is %s', async (_, text) => {
    const run = await runHook('guard-bash', text)
    expectDeny(run, 'a entrada do hook não pôde ser lida')
  })

  it('passes a missing or non-string command', async () => {
    expectPass(await guard(undefined))
    expectPass(await guard(42))
    expectPass(await runHook('guard-bash', { tool_name: 'Bash' }))
  })

  it('judges Monitor and run_in_terminal like Bash', async () => {
    expectDeny(
      await guard('gh issue reopen 5', {
        tool: 'Monitor',
        toolInput: { description: 'x' },
      }),
    )
    expectDeny(
      await guard('gh issue reopen 5', {
        tool: 'mcp__terminal__run_in_terminal',
      }),
    )
  })

  it('resolves run_in_terminal’s cwd against the input cwd', async () => {
    const run = await guard('git commit -m x', {
      repo: onMain,
      tool: 'mcp__terminal__run_in_terminal',
      toolInput: { cwd: 'repo' },
      input: { cwd: onMain.root },
    })
    expectDeny(run, 'commit em main: trabalhe numa branch da issue')
  })

  it('follows cd to the repository a command runs in', async () => {
    expectDeny(
      await guard('cd repo && git commit -m x', {
        repo: onMain,
        input: { cwd: onMain.root },
      }),
      /commit em main/,
    )
    expectPass(
      await guard(`cd ${feature.dir} && git commit -m x`, {
        repo: onMain,
        input: { cwd: onMain.root },
      }),
    )
  })

  it('denies when the rules fail, instead of passing', async () => {
    const run = await guard('git commit -m x', {
      env: { ...feature.env(), PATH: '/nao/existe' },
    })
    expectDeny(run, /o hook falhou: git não pôde rodar/)
  })
})

describe.concurrent('git through the hook', () => {
  it('denies a commit or a push on main', async () => {
    expectDeny(
      await guard('git commit -am "Hooks"', { repo: onMain }),
      /commit em main/,
    )
    expectDeny(await guard('git push origin HEAD:main'), /push em main/)
  })

  it('denies a skip token in a commit message', async () => {
    expectDeny(await guard('git commit -m "Hooks [skip ci]"'), /\[skip ci\]/)
  })

  it('denies a skip token in a merge commit message (Copilot review of #26)', async () => {
    expectDeny(
      await guard("git merge --no-ff -m '[skip ci]' origin/main"),
      /a mensagem do merge traz "\[skip ci\]"/,
    )
    expectDeny(
      await guard(
        String.raw`printf 'Trazer main\n\n[no ci]\n' > msg-ok.txt && git merge --no-ff -F msg-ok.txt origin/main`,
      ),
      /a mensagem do merge traz "\[no ci\]"/,
    )
  })

  it('asks for a commit after a cd it cannot read', async () => {
    expectAsk(
      await guard('cd "$WORKTREE" && git commit -m x'),
      /diretório em que o git commit roda/,
    )
  })

  it('passes a commit in another repository', async () => {
    expectPass(await guard('git commit -m "x [skip ci]"', { repo: elsewhere }))
  })
})

describe.concurrent('the label transition, read live', () => {
  const transition =
    'gh issue edit 5 --remove-label needs-triage --add-label ready-for-human'
  const issue = (over: Record<string, unknown> = {}) => ({
    issues: {
      5: {
        labels: ['enhancement', 'needs-triage'],
        lastCommentBody: '# Plano\n\n## Contexto e porquê\n\nTexto.',
        ...over,
      },
    },
  })

  test('passes, after reading the issue', async ({ live }) => {
    const gh = live(issue())
    expectPass(await guard(transition, { env: gh.env }))
    expect(gh.calls()).toEqual([
      expect.objectContaining({ call: 'issueState', key: '5', mode: 'ok' }),
    ])
  })

  test('denies ready-for-agent, without reading', async ({ live }) => {
    const gh = live(issue())
    expectDeny(
      await guard(
        'gh issue edit 5 --remove-label needs-triage --add-label ready-for-agent',
        {
          env: gh.env,
        },
      ),
      /o Approve e ready-for-agent são do dono/,
    )
    expect(gh.calls()).toEqual([])
  })

  test('denies another label in the same command, without reading', async ({
    live,
  }) => {
    const gh = live(issue())
    expectDeny(await guard(`${transition} --add-label bug`, { env: gh.env }))
    expect(gh.calls()).toEqual([])
  })

  test('denies two issue numbers, without reading', async ({ live }) => {
    const gh = live(issue())
    expectDeny(
      await guard(
        'gh issue edit 5 6 --remove-label needs-triage --add-label ready-for-human',
        {
          env: gh.env,
        },
      ),
    )
    expect(gh.calls()).toEqual([])
  })

  test('denies an issue not in needs-triage', async ({ live }) => {
    const gh = live(issue({ labels: ['enhancement', 'needs-info'] }))
    expectDeny(
      await guard(transition, { env: gh.env }),
      /não está em needs-triage/,
    )
  })

  test('denies when the last comment is not a # Plano', async ({ live }) => {
    const gh = live(issue({ lastCommentBody: 'Obrigado!' }))
    expectDeny(await guard(transition, { env: gh.env }), /não abre com # Plano/)
  })

  test('asks, critical, when gh fails, and denies it in auto (Copilot review of #26, third round)', async ({
    live,
  }) => {
    const gh = live(issue({ mode: 'fail' }))
    const reason =
      /não consegui confirmar que a issue está em needs-triage com um # Plano como último comentário \(HTTP 502/
    expectAsk(await guard(transition, { env: gh.env }), reason)
    expectDeny(await guard(transition, { env: gh.env, mode: 'auto' }), reason)
  })

  test('asks when gh is slower than the timeout', async ({ live }) => {
    const gh = live(issue({ mode: 'slow' }), {
      LOOP_HOOKS_GH_TIMEOUT_MS: '400',
    })
    const started = Date.now()
    expectAsk(
      await guard(transition, { env: gh.env }),
      /gh não respondeu em 400 ms/,
    )
    expect(Date.now() - started).toBeLessThan(15_000)
  })
})

const copilot = {
  __typename: 'Bot',
  login: copilotReviewer.login,
  databaseId: copilotReviewer.databaseId,
}

const readyPr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  state: 'OPEN',
  headRefOid: HEAD,
  suites: requiredChecks.map(({ workflow, job }) => ({
    workflow,
    runs: [
      {
        name: job,
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        startedAt: '2026-09-26T10:00:00Z',
      },
    ],
  })),
  reviews: [
    {
      state: 'COMMENTED',
      submittedAt: '2026-09-26T10:10:00Z',
      commit: { oid: HEAD },
      author: copilot,
      body: 'Copilot reviewed 3 out of 3 changed files in this pull request.',
    },
  ],
  requests: [],
  threads: [{ isResolved: true }],
  ...over,
})

describe.concurrent('gh pr merge, read live', () => {
  test('asks, critical, when everything is in order', async ({ live }) => {
    const gh = live({ prs: { 7: { pr: readyPr() } } })
    expectAsk(
      await guard('gh pr merge 7 --squash --delete-branch', { env: gh.env }),
      /confira antes do merge: PR #7 na cabeça aaaaaaa, Vínculo com issue \/ issue-link e Qualidade \/ check verdes/,
    )
  })

  test.for(['auto', 'bypassPermissions', 'dontAsk'])(
    'denies the same merge in %s',
    async (mode, { live }) => {
      const gh = live({ prs: { 7: { pr: readyPr() } } })
      expectDeny(
        await guard('gh pr merge 7 --squash', { env: gh.env, mode }),
        new RegExp(
          `confira antes do merge.* Em ${mode}, a confirmação vira negação`,
        ),
      )
    },
  )

  test('reads the PR of the current branch', async ({ live }) => {
    const gh = live({ heads: { [FEATURE]: { prs: [readyPr()] } } })
    expectAsk(await guard('gh pr merge --squash', { env: gh.env }), /PR #7/)
    expect(gh.calls()).toEqual([
      expect.objectContaining({ call: 'prByHead', key: FEATURE }),
    ])
  })

  test.for([
    [
      'a red check',
      {
        suites: [
          {
            workflow: requiredChecks[0].workflow,
            runs: [
              {
                name: requiredChecks[0].job,
                status: 'COMPLETED',
                conclusion: 'FAILURE',
                startedAt: '2026-09-26T10:00:00Z',
              },
            ],
          },
        ],
      },
      /checks exigidos: .*concluído com FAILURE/,
    ],
    [
      'no Copilot review on the head',
      { reviews: [] },
      /nenhuma revisão do Copilot na cabeça aaaaaaa/,
    ],
    [
      'a Copilot review on its way',
      { requests: [{ requestedReviewer: copilot }] },
      /pedida e ainda a caminho/,
    ],
    [
      'an open thread',
      { threads: [{ isResolved: false }] },
      /1 thread\(s\) de revisão aberta\(s\)/,
    ],
    [
      'threads past one page',
      { threadsTotal: 101 },
      /não li por inteiro: threads de revisão/,
    ],
  ] as const)(
    'denies with %s, naming it',
    async ([, over, reason], { live }) => {
      const gh = live({ prs: { 7: { pr: readyPr(over) } } })
      expectDeny(await guard('gh pr merge 7', { env: gh.env }), reason)
    },
  )

  test('asks, critical, when the read fails, and denies it in auto', async ({
    live,
  }) => {
    const gh = live({ prs: { 7: { mode: 'fail', pr: readyPr() } } })
    expectAsk(
      await guard('gh pr merge 7', { env: gh.env }),
      /não consegui ler o estado da PR/,
    )
    expectDeny(
      await guard('gh pr merge 7', { env: gh.env, mode: 'auto' }),
      /não consegui ler o estado da PR.* Em auto, a confirmação vira negação/,
    )
  })

  test('denies --admin and --auto without reading', async ({ live }) => {
    const gh = live({})
    expectDeny(await guard('gh pr merge 7 --admin', { env: gh.env }))
    expectDeny(await guard('gh pr merge 7 --auto --squash', { env: gh.env }))
    expect(gh.calls()).toEqual([])
  })
})

describe.concurrent('resolveReviewThread, read live', () => {
  const resolve = `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_1"}) { thread { isResolved } } }'`

  test('passes when the last comment is the account’s', async ({ live }) => {
    const gh = live({
      viewer: { login: 'geazioliveira' },
      threads: { PRRT_1: { lastAuthor: 'geazioliveira' } },
    })
    expectPass(await guard(resolve, { env: gh.env }))
    expect(gh.calls().map((call) => call.call)).toEqual([
      'threadLastAuthor',
      'viewer',
    ])
  })

  test('denies when someone else spoke last', async ({ live }) => {
    const gh = live({
      viewer: { login: 'geazioliveira' },
      threads: { PRRT_1: { lastAuthor: 'copilot-pull-request-reviewer' } },
    })
    expectDeny(
      await guard(resolve, { env: gh.env }),
      /responda na thread antes de resolvê-la/,
    )
  })

  test('asks when a read fails', async ({ live }) => {
    const gh = live({
      viewer: { mode: 'fail', login: 'geazioliveira' },
      threads: { PRRT_1: { lastAuthor: 'geazioliveira' } },
    })
    expectAsk(await guard(resolve, { env: gh.env }), /não consegui confirmar/)
  })
})

describe.concurrent(
  'the live reads go to the GitHub the command goes to (Copilot review of #26, fifth round)',
  () => {
    // Claude Code's environment may carry an enterprise GH_HOST while the
    // command names github.com. The hook's reads used to follow the
    // environment and judge the command by another GitHub's PR.
    const ghe = 'ghe.example.com'
    const inherited = { GH_HOST: ghe }
    const resolveThread = `-f query='mutation { resolveReviewThread(input: {threadId: "PRRT_1"}) { thread { isResolved } } }'`
    const transition =
      'gh issue edit 5 --remove-label needs-triage --add-label ready-for-human'
    const redCheck = {
      suites: [
        {
          workflow: requiredChecks[0].workflow,
          runs: [
            {
              name: requiredChecks[0].job,
              status: 'COMPLETED',
              conclusion: 'FAILURE',
              startedAt: '2026-09-26T10:00:00Z',
            },
          ],
        },
      ],
    }

    /** Every call went to github.com, with the host set on gh itself. */
    const expectGithubCom = (gh: Live, count: number) => {
      const calls = gh.calls()
      expect(calls).toHaveLength(count)
      for (const call of calls) {
        expect(call).toMatchObject({
          host: 'github.com',
          envHost: 'github.com',
        })
        expect(call.argv.slice(0, 4)).toEqual([
          'api',
          'graphql',
          '--hostname',
          'github.com',
        ])
        expect(call.violation).toBeUndefined()
      }
    }

    test.for([
      [
        'GH_HOST=github.com on the command',
        `GH_HOST=github.com gh pr merge 7 -R github.com/${'geazioliveira/marketo-sandbox'}`,
      ],
      [
        '-R github.com/OWNER/REPO alone',
        'gh pr merge 7 -R github.com/geazioliveira/marketo-sandbox',
      ],
      [
        'the PR URL',
        'gh pr merge https://github.com/geazioliveira/marketo-sandbox/pull/7',
      ],
      [
        'GH_HOST=github.com exported earlier on the line',
        'export GH_HOST=github.com; gh pr merge 7',
      ],
    ])(
      'gh pr merge with %s over an inherited enterprise GH_HOST reads github.com’s PR',
      async ([, command], { live }) => {
        const gh = live(
          {
            prs: { 7: { pr: readyPr(redCheck) } },
            hosts: { [ghe]: { prs: { 7: { pr: readyPr() } } } },
          },
          inherited,
        )
        expectDeny(
          await guard(command, { env: gh.env }),
          /concluído com FAILURE/,
        )
        expectGithubCom(gh, 1)
      },
    )

    test('gh pr merge of the current branch reads github.com’s open PR', async ({
      live,
    }) => {
      const gh = live(
        {
          heads: {
            [FEATURE]: { prs: [readyPr({ threads: [{ isResolved: false }] })] },
          },
          hosts: { [ghe]: { heads: { [FEATURE]: { prs: [readyPr()] } } } },
        },
        inherited,
      )
      expectDeny(
        await guard('GH_HOST=github.com gh pr merge --squash', { env: gh.env }),
        /thread\(s\) de revisão aberta\(s\)/,
      )
      expectGithubCom(gh, 1)
    })

    test('the label transition reads github.com’s issue', async ({ live }) => {
      const gh = live(
        {
          issues: {
            5: {
              labels: ['enhancement', 'needs-info'],
              lastCommentBody: '# Plano\n\nTexto.',
            },
          },
          hosts: {
            [ghe]: {
              issues: {
                5: {
                  labels: ['enhancement', 'needs-triage'],
                  lastCommentBody: '# Plano\n\nTexto.',
                },
              },
            },
          },
        },
        inherited,
      )
      expectDeny(
        await guard(`GH_HOST=github.com ${transition}`, { env: gh.env }),
        /não está em needs-triage/,
      )
      expectGithubCom(gh, 1)
    })

    test.for([
      [
        '--hostname github.com',
        `gh api graphql --hostname github.com ${resolveThread}`,
      ],
      [
        'GH_HOST=github.com',
        `GH_HOST=github.com gh api graphql ${resolveThread}`,
      ],
    ])(
      'resolveReviewThread with %s reads github.com’s thread and account',
      async ([, command], { live }) => {
        const gh = live(
          {
            viewer: { login: 'geazioliveira' },
            threads: {
              PRRT_1: { lastAuthor: 'copilot-pull-request-reviewer' },
            },
            hosts: {
              [ghe]: {
                viewer: { login: 'geazioliveira' },
                threads: { PRRT_1: { lastAuthor: 'geazioliveira' } },
              },
            },
          },
          inherited,
        )
        expectDeny(
          await guard(command, { env: gh.env }),
          /responda na thread antes de resolvê-la/,
        )
        expectGithubCom(gh, 2)
      },
    )

    test('keeps GH_REPO out of the reads: the call names its repository', async ({
      live,
    }) => {
      const gh = live(
        { prs: { 7: { pr: readyPr(redCheck) } } },
        { GH_REPO: 'geazioliveira/marketo-sandbox' },
      )
      expectDeny(await guard('gh pr merge 7', { env: gh.env }))
      expect(gh.calls()).toEqual([
        expect.objectContaining({
          call: 'prByNumber',
          host: 'github.com',
          envRepo: null,
        }),
      ])
    })

    test('another GitHub named by -R is not read, from github.com or elsewhere', async ({
      live,
    }) => {
      const gh = live({ prs: { 7: { pr: readyPr(redCheck) } } })
      expectPass(
        await guard(`gh pr merge 7 -R ${ghe}/geazioliveira/marketo-sandbox`, {
          env: gh.env,
        }),
      )
      expect(gh.calls()).toEqual([])
    })

    test.for([
      [
        'resolveReviewThread on --hostname "$H"',
        `gh api graphql --hostname "$H" ${resolveThread}`,
        /não consegui confirmar que a última resposta da thread é sua/,
      ],
      [
        'resolveReviewThread on GH_HOST=$H',
        `GH_HOST=$H gh api graphql ${resolveThread}`,
        /não consegui confirmar que a última resposta da thread é sua/,
      ],
      [
        'gh pr merge on GH_HOST=$H',
        'GH_HOST=$H gh pr merge 7',
        /não consegui ler o estado da PR/,
      ],
      [
        'the label transition on GH_HOST=$H',
        `GH_HOST=$H ${transition}`,
        /não consegui ler em que repositório/,
      ],
    ])(
      'reads nothing when the host cannot be read: %s asks, critical',
      async ([, command, reason], { live }) => {
        // github.com would let each through: nothing may be read there for
        // a command that may go elsewhere.
        const gh = live({
          viewer: { login: 'geazioliveira' },
          threads: { PRRT_1: { lastAuthor: 'geazioliveira' } },
          prs: { 7: { pr: readyPr() } },
          issues: {
            5: {
              labels: ['enhancement', 'needs-triage'],
              lastCommentBody: '# Plano\n\nTexto.',
            },
          },
        })
        expectAsk(await guard(command, { env: gh.env }), reason)
        expectDeny(
          await guard(command, { env: gh.env, mode: 'auto' }),
          /Em auto, a confirmação vira negação/,
        )
        expect(gh.calls()).toEqual([])
      },
    )
  },
)

describe.concurrent('the tripwire', () => {
  it.each([
    [
      'node -e',
      `node -e "require('child_process').execSync('gh issue edit 5 --add-label ready-for-agent')"`,
      'ready-for-agent',
    ],
    [
      'node -pe',
      `node -pe "require('child_process').execSync('gh issue view 5').includes('NEEDS-TRIAGE')"`,
      'needs-triage',
    ],
    [
      'python3 -c',
      `python3 -c "open('.git/loop-gate.json','w').write('{}')"`,
      'loop-gate.json',
    ],
    [
      'perl -e',
      `perl -e 'system("gh", "issue", "comment", "5", "-b", "# Owner Approve")'`,
      'Owner Approve',
    ],
    [
      'ruby -e',
      `ruby -e 'File.delete(Dir[".git/loop-plan-pending-*"][0])'`,
      'loop-plan-pending-',
    ],
    [
      'osascript -e',
      `osascript -e 'do shell script "echo resolveReviewThread"'`,
      'resolveReviewThread',
    ],
    [
      'deno eval',
      `deno eval 'console.log("mergePullRequest")'`,
      'mergePullRequest',
    ],
    ['eval', `eval "echo Approve retirado"`, 'Approve retirado'],
    ['source', `source .claude/settings.local.json`, 'settings.local.json'],
    [
      'git config alias.',
      `git config alias.pronto '!gh issue edit $1 --add-label ready-for-agent'`,
      'ready-for-agent',
    ],
    ['alias', `alias pronto='gh issue edit 5 --add-label wontfix'`, 'wontfix'],
    [
      'addLabelsToLabelable',
      `node -e "fetch('https://api.github.com/graphql', {body: 'addLabelsToLabelable'})"`,
      'addLabelsToLabelable',
    ],
    [
      'python -c taking the label as an argument',
      `python3 -c 'import subprocess,sys; subprocess.run(sys.argv[1:])' gh issue edit 5 --add-label ready-for-agent`,
      'ready-for-agent',
    ],
    [
      'python spelling a gh command',
      "python3 - <<'EOF'\nprint('gh issue edit 5 --add-label ready-for-agent')\nEOF",
      'ready-for-agent',
    ],
    [
      'python importing from urllib',
      "python3 - <<'EOF'\nfrom urllib.request import urlopen\nurlopen('https://x', b'needs-triage')\nEOF",
      'needs-triage',
    ],
    [
      'python reading its program from a pipe',
      "echo 'print(1)' | python3 - ready-for-agent",
      'ready-for-agent',
    ],
    [
      'node preloading a module',
      `node -r ./x.js -e "console.log('needs-triage')"`,
      'needs-triage',
    ],
    [
      'node importing code at run time',
      `node -e "import('./x.mjs').then((m) => m.run('ready-for-agent'))"`,
      'ready-for-agent',
    ],
    [
      'python that only writes, next to the gate cache',
      "python3 - <<'EOF'\nopen('.git/loop-gate.json', 'w').write('{}')\nEOF",
      'loop-gate.json',
    ],
    [
      'node that only prints, next to the owner’s escape hatch',
      `node -e "console.log(1)" && grep -c hooks .claude/settings.local.json`,
      'settings.local.json',
    ],
  ])('asks, critical, for %s next to a guarded name', async (_, text, name) => {
    const run = await runHook('guard-bash', {
      tool_name: 'Bash',
      tool_input: { command: text },
      cwd: tmpdir(),
      permission_mode: 'default',
    })
    expectAsk(
      run,
      new RegExp(
        `indireção que cita o loop: confira \\(.* junto de ${name}\\)`,
      ),
    )
  })

  it('denies in the autonomous modes', async () => {
    const run = await runHook('guard-bash', {
      tool_name: 'Bash',
      tool_input: {
        command: `node -e "fetch(u, { body: 'ready-for-agent' })"`,
      },
      cwd: tmpdir(),
      permission_mode: 'dontAsk',
    })
    expectDeny(
      run,
      /indireção que cita o loop.* Em dontAsk, a confirmação vira negação/,
    )
  })

  it('lets the alias rule deny a gh alias set that the rules deny', async () => {
    expectDeny(
      await guard(
        `gh alias set pronto 'issue edit $1 --add-label ready-for-agent'`,
      ),
      /o alias pronto/,
    )
  })

  it.each([
    ['an evaluator with no guarded name', 'node -e "console.log(1 + 1)"'],
    ['a guarded name with no evaluator', 'echo ready-for-agent > /tmp/x'],
    ['a grep for the Approve', 'grep "Owner Approve" -r context'],
    // A program that can neither start a process nor reach the network
    // cannot act on a label, whatever text it edits (the corpus of #5).
    [
      'a python heredoc that edits a document about needs-triage',
      "python3 - <<'EOF'\np = 'context/intent/x.md'\ns = open(p, encoding='utf8').read()\ns = s.replace('em needs-triage', 'em `needs-triage`')\nopen(p, 'w', encoding='utf8').write(s)\nEOF",
    ],
    [
      'a python heredoc that compiles a regex naming ready-for-agent',
      "python3 - <<'EOF'\nimport re, sys\nprint(re.compile(r'ready-for-agent').search(sys.argv[0]))\nEOF",
    ],
    [
      'a python heredoc that mentions gh only as a word',
      "python3 - <<'EOF'\nprint('as regras de `gh` e de `git` citam needs-triage')\nEOF",
    ],
    [
      'node -pe that only prints a label',
      `node -pe "'NEEDS-TRIAGE'.toLowerCase()"`,
    ],
    [
      'perl -e that only prints the Approve',
      `perl -e 'print "# Owner Approve"'`,
    ],
  ])('passes %s', async (_, text) => {
    expectPass(
      await runHook('guard-bash', {
        tool_name: 'Bash',
        tool_input: { command: text },
        cwd: tmpdir(),
      }),
    )
  })
})

describe.concurrent('which repository a gh command acts on', () => {
  test('passes --repo pointing elsewhere, without reading', async ({
    live,
  }) => {
    const gh = live({})
    expectPass(
      await guard(
        'gh issue edit 5 --add-label ready-for-agent --repo alguem/outro',
        {
          env: gh.env,
        },
      ),
    )
    expectPass(
      await guard('gh pr merge 7 --admin -R alguem/outro', { env: gh.env }),
    )
    expect(gh.calls()).toEqual([])
  })

  it('passes gh in another repository', async () => {
    expectPass(await guard('gh issue reopen 5', { repo: elsewhere }))
  })
})

describe.concurrent(
  'a remote changed earlier on the line (Copilot review of #26)',
  () => {
    const PROJECT_URL = 'https://github.com/geazioliveira/marketo-sandbox.git'
    const reopen = /reabrir uma issue cancela o Approve/

    it.each([
      `git remote set-url origin ${PROJECT_URL} && gh issue reopen 5`,
      `git config remote.origin.url ${PROJECT_URL} && gh issue reopen 5`,
      `git remote rename origin velho; git remote add origin ${PROJECT_URL}; gh issue reopen 5`,
      'git remote set-url origin "$URL" && gh issue reopen 5',
      `git remote add upstream ${PROJECT_URL} && gh issue reopen 5`,
      `git config --global url.${PROJECT_URL}.insteadOf https://github.com/alguem/outro.git && gh issue reopen 5`,
      `gh issue reopen 5 "$(git remote set-url origin ${PROJECT_URL})"`,
    ])('denies, in another repository, %s', async (text) => {
      expectDeny(await guard(text, { repo: elsewhere }), reopen)
    })

    it('fills the placeholders from the changed origin', async () => {
      expectDeny(
        await guard(
          `git remote set-url origin ${PROJECT_URL} && gh api repos/{owner}/{repo}/issues/5/labels -f 'labels[]=ready-for-agent'`,
          { repo: elsewhere },
        ),
        /label de estado/,
      )
    })

    it('still judges this project when origin is pointed away: the change may fail', async () => {
      expectDeny(
        await guard(
          'git remote add origin https://github.com/alguem/outro.git; gh issue reopen 5',
        ),
        reopen,
      )
    })

    it('passes when origin still names another repository, or the change lands elsewhere', async () => {
      expectPass(
        await guard('git remote -v && gh issue reopen 5', { repo: elsewhere }),
      )
      expectPass(
        await guard(
          'git remote set-url origin https://github.com/alguem/outra.git && gh issue reopen 5',
          { repo: elsewhere },
        ),
      )
      expectPass(
        await guard(
          `git -C ${feature.dir} remote set-url origin ${PROJECT_URL} && gh issue reopen 5`,
          { repo: elsewhere },
        ),
      )
    })
  },
)

describe.concurrent('commands that must pass', () => {
  test.for([
    'gh issue view 5 --comments',
    'gh pr view 7',
    'gh pr checks 7',
    'grep "Owner Approve" -r context',
    'git log --oneline -5',
    'git status',
    'echo ready-for-agent > /tmp/x',
    'gh issue comment 5 --body "Rodei o gate: passou."',
    'npm run gate && git diff --stat',
  ])('%s', async (text, { live }) => {
    const gh = live({})
    expectPass(await guard(text, { env: gh.env }))
    expect(gh.calls()).toEqual([])
  })
})

describe.concurrent('the whole line', () => {
  it('finds gh behind bash -c, a substitution and sudo', async () => {
    expectDeny(await guard(`bash -c 'gh issue reopen 5'`))
    expectDeny(await guard('echo "$(gh issue reopen 5)"'))
    expectDeny(await guard('sudo -u geazi gh issue reopen 5'))
  })

  it('lets a deny win over an ask, and keeps only its reasons', async () => {
    const run = await guard(
      'gh issue comment 5 --body "$X" && gh issue reopen 5',
    )
    expectDeny(run, /reabrir uma issue/)
    expect(reasonOf(run)).not.toMatch(/não consegui ler o corpo/)
  })

  it('asks when a line that mentions gh cannot be read whole', async () => {
    expectAsk(
      await guard(`gh issue comment 5 --body 'sem fim`),
      'não consegui ler o comando inteiro',
    )
  })

  it('passes an unreadable line that mentions neither gh nor git', async () => {
    expectPass(await guard(`echo 'sem fim`))
  })

  it('never answers allow', async () => {
    const runs = await Promise.all(
      [
        'gh issue reopen 5',
        'gh issue comment 5 -b "$X"',
        'gh issue view 5',
      ].map((text) => guard(text)),
    )
    for (const run of runs)
      expect(['deny', 'ask', null]).toContain(decisionOf(run))
  })
})

const outside = (
  command: string,
  mode = 'default',
  env?: NodeJS.ProcessEnv,
): Promise<HookRun> =>
  runHook(
    'guard-bash',
    {
      tool_name: 'Bash',
      tool_input: { command },
      cwd: tmpdir(),
      permission_mode: mode,
    },
    env === undefined ? {} : { env },
  )

/** A critical ask: an ask here, and a deny once resolved in an autonomous mode (checked beside it). */
const expectCritical = (run: HookRun, reason?: RegExp | string) =>
  expectAsk(run, reason)

describe.concurrent(
  'what an earlier command of the line leaves (review of #5)',
  () => {
    it.each([
      ['git checkout main && git commit -am x', /commit em main/],
      [
        `git switch main && git merge ${FEATURE} && git push`,
        /commit em main.*push em main/,
      ],
      ['git checkout main; git push origin HEAD', /push em main/],
      [
        `git checkout -q main && gh pr create --base main --body 'Closes #5.'`,
        /"main" não é uma/,
      ],
      ['git branch -m main && git push origin HEAD', /push em main/],
      [
        'git config alias.ci commit && git checkout main && git ci -m x',
        /o alias ci do git é "commit": commit em main/,
      ],
      ['git config push.default matching && git push', /push.default=matching/],
    ])('denies %s', async (text, reason) => {
      expectDeny(await guard(text), reason)
    })

    it('asks when the branch an earlier command checked out cannot be told', async () => {
      expectAsk(
        await guard('gh pr checkout 7 && git push origin HEAD'),
        /um comando anterior da linha muda o HEAD/,
      )
      expectAsk(
        await guard('git checkout - && git commit -m x'),
        /um comando anterior da linha muda o HEAD/,
      )
    })

    it.each([
      'git checkout -b feature/9-x && git push -u origin HEAD',
      'git commit -m x && git checkout main && git fetch',
      'git stash && git checkout main && git stash list',
      'git checkout README.md && git commit -m x',
    ])('passes %s', async (text) => {
      expectPass(await guard(text))
    })

    it.each([
      'git commit -m x && git checkout main && git pull',
      'git stash && git checkout main && git stash pop',
      'git switch main && git checkout -- README.md',
    ])(
      'denies %s: a write to the worktree after main was checked out (fourth round)',
      async (text) => {
        expectDeny(await guard(text), /em main, nada se edita/)
      },
    )

    it('reads a gh alias set earlier on the line', async () => {
      expectDeny(
        await guard(
          'gh alias set j issue && gh j edit 5 --add-label ready-for-agent',
        ),
        /o alias j do gh é "issue"/,
      )
    })

    test('reads a gh alias from gh’s config', async ({ live }) => {
      const gh = live({})
      const config = path.join(feature.root, 'gh-config')
      mkdirSync(path.join(config, 'gh'), { recursive: true })
      writeFileSync(
        path.join(config, 'gh', 'config.yml'),
        'aliases:\n    i: issue\n    k: |\n        pr merge --auto\n',
      )
      const env = { ...gh.env, XDG_CONFIG_HOME: config }
      expectDeny(
        await guard('gh i edit 5 --add-label ready-for-agent', { env }),
        /o alias i do gh é "issue"/,
      )
      expectDeny(await guard('gh k 7', { env }), /o merge automático/)
      expect(gh.calls()).toEqual([])
    })

    it('carries export to the commands after it', async () => {
      expectDeny(
        await outside(
          `export GH_REPO=geazioliveira/marketo-sandbox; gh issue comment 5 -b '# Owner Approve'`,
        ),
        /não abre como Approve/,
      )
      expectPass(await guard('export GH_REPO=alguem/outro; gh issue reopen 5'))
      expectDeny(
        await guard(
          'export GH_REPO=alguem/outro; unset GH_REPO; gh issue reopen 5',
        ),
      )
    })

    it('judges a gh command after a cd it cannot read as this project', async () => {
      expectDeny(
        await guard(
          `P=${feature.dir}; cd "$P" && gh issue edit 5 --add-label ready-for-agent`,
          { repo: elsewhere },
        ),
        /ready-for-agent são do dono/,
      )
    })

    it('follows GIT_DIR to the repository git and gh use', async () => {
      expectDeny(
        await guard(
          `GIT_DIR=${feature.gitDir} gh issue edit 5 --add-label ready-for-agent`,
          {
            repo: elsewhere,
          },
        ),
      )
      expectDeny(
        await guard(
          `GIT_DIR=${onMain.gitDir} GIT_WORK_TREE=${onMain.dir} git commit -m x`,
        ),
        /commit em main/,
      )
      expectDeny(
        await guard(
          `git --git-dir=${onMain.gitDir} --work-tree=${onMain.dir} commit -m x`,
        ),
        /commit em main/,
      )
    })

    it('reads a body or a message as an earlier command of the line wrote it', async () => {
      expectDeny(
        await guard(
          String.raw`printf '# Owner Approve\n\nok\n' > b-recado.md && gh issue comment 5 --body-file b-recado.md`,
        ),
        /não abre como Approve/,
      )
      expectDeny(
        await guard(
          String.raw`printf 'x\n\n[skip ci]\n' > msg-ok.txt && git commit -F msg-ok.txt`,
        ),
        /\[skip ci\]/,
      )
      expectDeny(
        await guard(
          "cat > corpo-novo.md <<'EOF'\n# Approve retirado\nEOF\ngh issue comment 5 -F corpo-novo.md",
        ),
        /não abre como Approve/,
      )
      expectAsk(
        await guard(
          'gera-corpo > b-recado.md && gh issue comment 5 -F b-recado.md',
        ),
        /não consegui ler o corpo do comentário/,
      )
    })

    it('passes a plan written to a file and posted from it, in auto', async () => {
      expectPass(
        await guard(
          "cat > plano.md <<'EOF'\n# Plano\n\nUm alias com needs-triage e ready-for-human.\nEOF\ngh issue comment 5 -F plano.md",
          { mode: 'auto' },
        ),
      )
    })
  },
)

describe.concurrent(
  'programs whose command the rules cannot read (review of #5)',
  () => {
    it.each([
      [
        'a program named by a variable assigned only maybe',
        'if true; then G=gh; fi; $G issue edit 5 --add-label ready-for-agent',
      ],
      [
        'a program named by a substitution',
        `"$(command -v gh)" issue comment 5 -b '# Owner Approve'`,
      ],
      [
        'bash -c of a variable read from a substitution',
        `C="$(printf 'gh issue edit 5 --add-label ready-for-agent')"; bash -c "$C"`,
      ],
      [
        'sh reading a pipe',
        `echo 'gh issue edit 5 --add-label ready-for-agent' | sh`,
      ],
      ['parallel', 'parallel gh issue edit 5 --add-label ::: ready-for-agent'],
      [
        'python reading its program from stdin',
        "python3 - <<'EOF'\nimport os; os.system('gh issue edit 5 --add-label ready-for-agent')\nEOF",
      ],
    ])('asks, critical, for %s next to a guarded name', async (_, text) => {
      const run = await guard(text)
      expectCritical(run, /indireção que cita o loop/)
      expectDeny(
        await guard(text, { mode: 'auto' }),
        /Em auto, a confirmação vira negação/,
      )
    })

    it.each([
      [
        'sh reading a pipe',
        `echo 'gh issue reopen 5' | sh`,
        /o sh roda o que chega pelo pipe/,
      ],
      [
        'a program named by a variable',
        '$EDITOR notas.md && git status',
        /não consegui ler o programa que o comando roda em "\$EDITOR"/,
      ],
      [
        'xargs appending a label',
        'echo ready-for-agent | xargs gh issue edit 5 --add-label',
        /não consegui ler as labels/,
      ],
      [
        'xargs replacing {}',
        'echo ready-for-agent | xargs -I{} gh issue edit 5 --add-label {}',
        /não consegui ler as labels/,
      ],
      [
        'xargs appending a refspec',
        'echo HEAD:main | xargs git push origin',
        /não consegui ler o destino do push/,
      ],
      [
        'find -execdir',
        'find . -name x -execdir git commit -m y ;',
        /diretório em que o git commit roda/,
      ],
    ])(
      'asks, critical, for %s, and denies it in auto (Copilot review of #26, third round)',
      async (_, text, reason) => {
        expectAsk(await guard(text), reason)
        expectDeny(
          await guard(text, { mode: 'auto' }),
          /Em auto, a confirmação vira negação/,
        )
      },
    )

    it.each([
      ['sh reading a file', 'sh < reabre.sh'],
      ['bash running a file', 'bash reabre.sh'],
      [
        'a script written earlier on the line',
        "cat > s2.sh <<'EOF'\ngh issue reopen 5\nEOF\nsh s2.sh",
      ],
      [
        'find -exec',
        "find . -maxdepth 0 -exec gh issue edit 5 --add-label ready-for-agent ';'",
      ],
      ['watch', 'watch -n 5 gh pr merge 7 --admin'],
      ['watch -x', 'watch -x gh issue reopen 5'],
    ])('reads and judges the commands of %s', async (_, text) => {
      expectDeny(await guard(text))
    })

    it.each([
      '$EDITOR notas.md',
      'node --version && gh issue view 5 --json labels',
      'sh nao-existe.sh',
      "echo 'ls' | sh",
    ])('passes %s', async (text) => {
      expectPass(await guard(text))
    })
  },
)

describe.concurrent('variables the line assigns (corpus of #5)', () => {
  it.each([
    [
      'a label',
      'R=ready-for-agent; gh issue edit 5 --add-label $R',
      /ready-for-agent são do dono/,
    ],
    [
      'an exported label',
      'export L=ready-for-agent; gh issue edit 5 --add-label "$L"',
      /ready-for-agent são do dono/,
    ],
    [
      'an Approve body',
      'B="# Owner Approve"; gh issue comment 5 --body "$B"',
      /não abre como Approve/,
    ],
    [
      'an Approve body in a heredoc',
      'B="# Owner Approve"\ngh issue comment 5 --body-file - <<EOF\n$B\nEOF',
      /não abre como Approve/,
    ],
    [
      'a program named by a variable',
      'G=gh; $G issue edit 5 --add-label ready-for-agent',
      /ready-for-agent são do dono/,
    ],
    [
      'bash -c of a variable',
      `C='gh issue edit 5 --add-label ready-for-agent'; bash -c "$C"`,
      /ready-for-agent são do dono/,
    ],
    [
      'a write to the owner’s escape hatch',
      `F=.claude/settings.local.json; echo '{}' > "$F"`,
      /saída de emergência do dono/,
    ],
  ])('denies %s', async (_, text, reason) => {
    expectDeny(await guard(text), reason)
  })

  it('denies a commit on main through git -C of a variable', async () => {
    expectDeny(
      await guard(
        `W="${onMain.dir}"; git -C "$W" add x && git -C "$W" commit -m x`,
      ),
      /commit em main/,
    )
  })

  test('reads a body file named through a variable', async ({ live }) => {
    const gh = live({})
    feature.write({ 'plano-var.md': '# Plano\n\n## Contexto\n\nTexto.\n' })
    expectPass(
      await guard(
        `SP="${feature.dir}"; gh issue comment 8 --body-file "$SP/plano-var.md"`,
        { env: gh.env },
      ),
    )
    expect(gh.calls()).toEqual([])
  })

  test('reads an endpoint and a body named through variables', async ({
    live,
  }) => {
    const gh = live({})
    expectPass(
      await guard(
        'R=geazioliveira/marketo-sandbox; SIG=$\'\\n\\n_Addressed_\'\ngh api "repos/$R/pulls/14/comments/1/replies" -f body="Procede, corrigido.$SIG" --jq \'.html_url\'',
        { env: gh.env },
      ),
    )
    expect(gh.calls()).toEqual([])
  })

  it('reads git -C and cd of a variable', async () => {
    expectPass(
      await guard(
        `W="${feature.dir}"; git -C "$W" add x && git -C "$W" commit -q -m x`,
      ),
    )
    const scratch = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), 'guard-bash-var-')),
    )
    mkdirSync(path.join(scratch, 'rewrite'))
    try {
      expectPass(
        await guard(
          `SP="${scratch}"; cd "$SP/rewrite" && git init -q && git commit -qm base`,
          { repo: onMain },
        ),
      )
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it.each([
    ['assigned only inside an if', 'if true; then SP="$D"; fi; '],
    [
      'assigned after a command that may fail',
      'grep -q Recado b-recado.md && SP="$D"; ',
    ],
    ['assigned from a substitution', 'SP="$(pwd)"; '],
    ['unset before its use', 'SP="$D"; unset SP; '],
    ['never assigned on the line, though the hook’s environment has it', ''],
  ])('asks for a body file under a variable %s', async (_, prefix) => {
    feature.write({ 'plano-var2.md': '# Plano\n' })
    const text = `${prefix.replace('$D', feature.dir)}gh issue comment 8 --body-file "$SP/plano-var2.md"`
    expectAsk(
      await guard(text, { env: feature.env({ SP: feature.dir }) }),
      /não consegui ler o corpo do comentário/,
    )
  })
})

describe.concurrent(
  'what a program the hook does not read leaves (review of #5)',
  () => {
    it('asks for a body file an interpreter program may have rewritten', async () => {
      // b-recado.md holds a harmless text on disk; the program may put
      // anything there before gh reads it.
      const text =
        "python3 - <<'EOF'\nopen('b-recado.md', 'w').write('# Owner Approve\\n')\nEOF\ngh issue comment 5 --body-file b-recado.md"
      const run = await guard(text)
      expectAsk(run, /não consegui ler o corpo do comentário/)
      expect(reasonOf(run)).not.toMatch(/indireção/)
      // Critical since the third round of Copilot's review of #26.
      expectDeny(
        await guard(text, { mode: 'auto' }),
        /não consegui ler o corpo do comentário/,
      )
    })

    it('asks when the program runs in a substitution, judged last', async () => {
      const run = await guard(
        `echo "$(python3 -c "open('b-recado.md', 'w').write('# Owner Approve')")"; gh issue comment 5 --body-file b-recado.md`,
      )
      expectAsk(run, /não consegui ler o corpo do comentário/)
    })

    it('still reads a file the line itself writes after the program', async () => {
      expectPass(
        await guard(
          "python3 - <<'EOF'\nprint(1)\nEOF\nprintf '# Plano\\n' > p-depois.md; gh issue comment 5 --body-file p-depois.md",
        ),
      )
    })

    it('reads the disk as before when no such program ran', async () => {
      expectPass(await guard('gh issue comment 5 --body-file b-recado.md'))
    })
  },
)

describe.concurrent('writes to the files the loop keeps (review of #5)', () => {
  it.each([
    [
      `printf '{"disableAllHooks":true}' > .claude/settings.local.json`,
      /saída de emergência do dono/,
    ],
    [
      `echo '{}' | tee .claude/settings.local.json`,
      /saída de emergência do dono/,
    ],
    [
      'rm -f "$(git rev-parse --git-dir)"/loop-plan-pending-*',
      /só o gate e os hooks escrevem/,
    ],
    ['cp forjado.json .git/loop-gate.json', /só o gate e os hooks escrevem/],
    [
      'mv .git/loop-plan-pending-sessao-1.json /tmp/',
      /só o gate e os hooks escrevem/,
    ],
    ['tee .git/loop-gate.json < /dev/null', /só o gate e os hooks escrevem/],
    [
      'rsync -a -g /tmp/x .claude/settings.local.json',
      /saída de emergência do dono/,
    ],
    // Judged by where the write lands, when the line does not spell the
    // protected name: a source rsync removes, a find, a pattern, a whole
    // directory.
    [
      'rsync -a --remove-source-files .git/loop-gate.json /tmp/',
      /só o gate e os hooks escrevem/,
    ],
    ['rsync -a --remove-source-files .git /tmp/g/', /o diretório git onde/],
    ["find .git -name 'loop-*' -delete", /o diretório git onde/],
    ['find .git -maxdepth 1 -exec rm {} +', /o diretório git onde/],
    ['rm -f .git/loop-*', /um padrão dentro do diretório git/],
    ['rm -rf .claude', /contém .claude\/settings.local.json/],
  ])('denies %s', async (text, reason) => {
    expectDeny(await guard(text), reason)
  })

  it.each([
    `sed -i '' 's/deny(/pass(/' .claude/hooks/lib/io.mjs`,
    'chmod 000 .claude/hooks/guard-bash.mjs',
    'echo x > .github/workflows/novo.yml',
    'cd .claude && rm -rf hooks',
    // The destination of a copy, a move's source, and where rsync keeps
    // backups are written.
    'cp /tmp/gate.mjs.bak scripts/gate.mjs',
    'mv scripts/gate.mjs /tmp/gate.mjs',
    'rsync -a /tmp/hooks/ .claude/hooks/',
    'rsync -a --backup-dir .claude/velho -b /tmp/a/ /tmp/b/',
    'install -d .claude/extra /tmp/extra',
    'ln -s /tmp/x.mjs .claude/hooks/x.mjs',
  ])('asks, critical, for %s', async (text) => {
    expectAsk(await guard(text), /caminho do harness: confira/)
    expectDeny(await guard(text, { mode: 'bypassPermissions' }))
  })

  it.each([
    ['rm -f .git/index.lock', /dentro do diretório git/],
    ["find . -name '*.orig' -delete", /contém o diretório git/],
    ['rm -rf scripts', /contém caminhos do harness/],
  ])(
    'asks, critical, for %s, judged by where it lands',
    async (text, reason) => {
      expectAsk(await guard(text), reason)
      expectDeny(await guard(text, { mode: 'auto' }))
    },
  )

  it.each([
    'echo x >> src/app.ts',
    'echo ready-for-agent > /tmp/x',
    'cp README.md /tmp/copia.md',
    'npm run gate > /tmp/gate.log 2>&1',
    // A source is only read: cp, rsync, install and ln write the destination.
    'cp scripts/gate.mjs /tmp/gate.mjs.bak',
    'cp -rt /tmp .claude/hooks',
    'rsync -t scripts/gate.mjs /tmp/gate.mjs',
    'rsync -a scripts/ /tmp/scripts/ --exclude .claude',
    'install -m 644 scripts/gate.mjs /tmp/gate.mjs',
    'ln -s "$PWD/scripts/gate.mjs" /tmp/gate-link.mjs',
    // Nothing of the loop's is reached.
    "find /tmp/x -name '*.log' -delete",
    "find src -name '*.ts' -print",
    'rsync -a --remove-source-files /tmp/a/ /tmp/b/',
    'rm -f src/velho.ts',
    // An interpreter's program is not a shell write: the tripwire reads it.
    "python3 - <<'EOF'\np = 'test/scripts/gate.spec.ts'\nprint(open('scripts/gate.mjs').read()[:10], p)\nEOF",
  ])('passes %s', async (text) => {
    expectPass(await guard(text))
  })

  it('passes a harness path of another repository', async () => {
    expectPass(
      await guard(`sed -i '' 's/a/b/' .claude/hooks/x.mjs`, {
        repo: elsewhere,
      }),
    )
  })
})

describe.concurrent(
  'the tripwire reads programs, not prose (review of #5)',
  () => {
    it.each([
      [
        'auto',
        "gh issue comment 5 --body-file - <<'EOF'\n# Plano\n\nTratar alias, source e needs-triage.\nEOF",
      ],
      [
        'bypassPermissions',
        "git commit -m 'Tratar gh alias set e a label ready-for-agent no hook. Refs #5'",
      ],
      ['auto', "gh issue comment 5 -b 'A source da label wontfix mudou.'"],
      ['dontAsk', "git commit -m 'node -e e eval citam ready-for-agent'"],
    ])(
      'passes, in %s, a text that only mentions an evaluator',
      async (mode, text) => {
        expectPass(await guard(text, { mode }))
      },
    )

    it('still reads the raw text of a line it cannot parse', async () => {
      expectAsk(
        await guard(`node -e "x('ready-for-agent')" 'sem fim`),
        /indireção que cita o loop: confira \(node -e junto de ready-for-agent\)/,
      )
    })
  },
)

describe.concurrent('gh api wherever it runs (review of #5)', () => {
  it('fills :owner and :repo', async () => {
    expectDeny(
      await guard(
        `gh api repos/:owner/:repo/issues/5/comments -f body='# Owner Approve'`,
      ),
      /não abre como Approve/,
    )
  })

  it('judges a GraphQL mutation run outside the project', async () => {
    expectDeny(
      await outside(
        `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "PR_1"}) { clientMutationId } }'`,
      ),
      /use gh pr merge/,
    )
  })

  it('judges a POST to an issue', async () => {
    expectDeny(
      await guard(
        'gh api repos/geazioliveira/marketo-sandbox/issues/5 -f state=open',
      ),
      /reabrir uma issue/,
    )
  })
})

describe.concurrent(
  'a program the hook cannot name, judged as gh, git and a shell (Copilot review of #26)',
  () => {
    const unnamed = /não consegui ler o programa que o comando roda em "/
    const repos = () => ({ feature, onMain })

    beforeAll(() => {
      // Files the controls run: harmless programs of other languages.
      feature.write({
        'script.py': "print('ok')\n",
        'x.mjs': "console.log('ok')\n",
      })
    })

    test.for([
      ['$CMD issue reopen 5', 'feature', /como gh: reabrir uma issue/],
      ['"$G" commit -m x', 'onMain', /como git: commit em main/],
      ['${CMD} pr merge 7', 'feature', /como gh: .*estado da PR/],
      ['$SH -c "gh issue reopen 5"', 'feature', /como sh: reabrir uma issue/],
      [
        "$SH <<'EOF'\ngh issue reopen 5\nEOF",
        'feature',
        /como sh: reabrir uma issue/,
      ],
      ["$SH <<< 'gh issue reopen 5'", 'feature', /como sh: reabrir uma issue/],
    ] as const)(
      'asks, critical, for %s, and denies it in auto',
      async ([text, where, reason], { live }) => {
        const gh = live({})
        const repo = repos()[where]
        const run = await guard(text, { repo, env: gh.env })
        expectCritical(run, unnamed)
        expect(reasonOf(run)).toMatch(reason)
        expectDeny(
          await guard(text, { repo, env: gh.env, mode: 'auto' }),
          /Em auto, a confirmação vira negação/,
        )
      },
    )

    it('keeps a plain ask plain', async () => {
      const run = await guard(`$SH -c 'gh issue edit 5 --body "Corpo novo."'`, {
        mode: 'auto',
      })
      expectAsk(run, unnamed)
      expect(reasonOf(run)).toMatch(
        /como sh: editar o corpo da issue depois do Approve o revoga/,
      )
    })

    it('judges the commands after it on what the line left before it: a checkout read as git moves no branch', async () => {
      // Read as git, `$X checkout -b …` leaves main; the program may be
      // another, and the commit then lands on main.
      expectDeny(
        await guard('$X checkout -b feature/9-x && git commit -m x', {
          repo: onMain,
        }),
        /commit em main/,
      )
    })

    it('still denies a program named by a variable the line assigns', async () => {
      expectDeny(
        await guard(`SH=bash; $SH -c 'gh issue reopen 5'`),
        /reabrir uma issue/,
      )
    })

    it.each([
      '$PY script.py',
      '"$NODE" x.mjs',
      'G=gh; $G issue view 5',
      'N=node; "$N" x.mjs',
    ])('passes %s', async (text) => {
      expectPass(await guard(text))
      expectPass(await guard(text, { mode: 'auto' }))
    })
  },
)

describe.concurrent('gh pr create --web (Copilot review of #26)', () => {
  it('asks, critical, and denies it in auto: the body is written in the browser', async () => {
    expectCritical(await guard('gh pr create --web'), /--web/)
    expectDeny(
      await guard('gh pr create --web', { mode: 'auto' }),
      /--web.*Em auto, a confirmação vira negação/,
    )
  })

  it('asks, critical, for a body file it cannot read, and denies it in auto (Copilot review of #26, third round)', async () => {
    expectAsk(
      await guard('gh pr create -t T -F /nao/existe.md'),
      /não consegui ler o corpo da PR/,
    )
    expectDeny(
      await guard('gh pr create -t T -F /nao/existe.md', { mode: 'auto' }),
      /não consegui ler o corpo da PR/,
    )
  })
})

describe.concurrent('the time budget of a run (Copilot review of #26)', () => {
  const transition = (n: number) =>
    `gh issue edit ${n} --remove-label needs-triage --add-label ready-for-human`
  const slowIssues = (numbers: number[]) => ({
    issues: Object.fromEntries(
      numbers.map((n) => [
        n,
        { mode: 'slow', labels: ['needs-triage'], lastCommentBody: '# Plano' },
      ]),
    ),
  })

  test('answers with a critical ask naming the budget, past it', async ({
    live,
  }) => {
    const numbers = [5, 6, 7, 8, 9]
    const gh = live(slowIssues(numbers), {
      LOOP_HOOKS_GH_TIMEOUT_MS: '4000',
      LOOP_HOOKS_BUDGET_MS: '2000',
      FAKE_GH_SLOW_MS: '60000',
    })
    const line = numbers.map(transition).join(' && ')
    const started = Date.now()
    const run = await guard(line, { env: gh.env })
    // Five reads of 4 s each would take 20 s; the budget ends the run at 2.
    expect(Date.now() - started).toBeLessThan(12_000)
    expectCritical(run, /o prazo de 2 s do hook acabou/)
    expectDeny(
      await guard(line, { env: gh.env, mode: 'auto' }),
      /o prazo de 2 s do hook acabou.*Em auto, a confirmação vira negação/,
    )
  })

  test('ends the one read of GitHub it cuts short with its own answer', async ({
    live,
  }) => {
    // Nothing starts after the read: taken for a gh that failed, it would
    // leave a plain ask, which auto lets through to the person.
    const gh = live(slowIssues([5]), {
      LOOP_HOOKS_GH_TIMEOUT_MS: '20000',
      LOOP_HOOKS_BUDGET_MS: '3000',
      FAKE_GH_SLOW_MS: '60000',
    })
    expectDeny(
      await guard(transition(5), { env: gh.env, mode: 'auto' }),
      /o prazo de 3 s do hook acabou.*Em auto, a confirmação vira negação/,
    )
  })

  test('bounds a git the rules start by what is left of it', async ({
    live,
  }) => {
    // The one read of the rules' own that `git cherry-pick main` makes, the
    // message it copies, hangs past git's own 10 s. Taken for a git that
    // failed, it would leave a plain ask, 10 s later.
    const bin = gitShim(
      path.join(feature.root, 'log-hangs'),
      'for arg in "$@"; do [ "$arg" = --no-walk ] && exec sleep 15; done',
    )
    const gh = live(
      {},
      {
        PATH: [bin, feature.bin, process.env.PATH ?? ''].join(path.delimiter),
        LOOP_HOOKS_BUDGET_MS: '3000',
      },
    )
    expectDeny(
      await guard('git cherry-pick main', { env: gh.env, mode: 'auto' }),
      /o prazo de 3 s do hook acabou.*Em auto, a confirmação vira negação/,
    )
  })

  test('ends a hung read of the rules at the timeout LOOP_HOOKS_GIT_TIMEOUT_MS gives it (#59)', async ({
    live,
  }) => {
    // The same hung read, with the shipped budget: the git's own timeout
    // ends it, and the read counts as a git that failed, a plain ask.
    const bin = gitShim(
      path.join(feature.root, 'log-hangs-own'),
      'for arg in "$@"; do [ "$arg" = --no-walk ] && exec sleep 15; done',
    )
    const gh = live(
      {},
      {
        PATH: [bin, feature.bin, process.env.PATH ?? ''].join(path.delimiter),
        LOOP_HOOKS_GIT_TIMEOUT_MS: '2000',
      },
    )
    const started = Date.now()
    const run = await guard('git cherry-pick main', { env: gh.env })
    // Before the 10 s a git gets when the variable is not read.
    expect(Date.now() - started).toBeLessThan(10_000)
    expectAsk(run)
    expect(reasonOf(run)).not.toMatch(/o prazo de/)
  })

  test('keeps a deny found before the budget ran out', async ({ live }) => {
    // Room for the first command's git reads on a busy machine; the slow
    // read of the second is what runs out.
    const gh = live(slowIssues([5]), {
      LOOP_HOOKS_GH_TIMEOUT_MS: '20000',
      LOOP_HOOKS_BUDGET_MS: '6000',
      FAKE_GH_SLOW_MS: '60000',
    })
    expectDeny(
      await guard(`gh issue reopen 7 && ${transition(5)}`, { env: gh.env }),
      /reabrir uma issue/,
    )
  })

  test('answers before the timeout settings.json gives the hook, with the budget it ships with', async ({
    live,
  }) => {
    // The hook's timeout as Claude Code reads it: past it, Claude Code kills
    // the hook and runs the command undecided.
    const settings = JSON.parse(
      readFileSync(path.join(projectRoot, '.claude', 'settings.json'), 'utf8'),
    ) as {
      hooks: Record<
        string,
        { matcher?: string; hooks: { command: string; timeout: number }[] }[]
      >
    }
    const timeoutMs =
      (settings.hooks.PreToolUse ?? [])
        .flatMap((group) => group.hooks)
        .find((hook) => hook.command.endsWith(' guard-bash'))?.timeout ?? 0
    expect(timeoutMs).toBeGreaterThan(0)
    // Three reads that each run until gh's own timeout, 30 s: 90 s in all,
    // past the hook's timeout, without a budget for the whole run.
    const numbers = [5, 6, 7]
    const gh = live(slowIssues(numbers), {
      LOOP_HOOKS_GH_TIMEOUT_MS: '30000',
      FAKE_GH_SLOW_MS: '120000',
    })
    const started = Date.now()
    const run = await guard(numbers.map(transition).join(' && '), {
      env: gh.env,
    })
    expect(Date.now() - started).toBeLessThan(timeoutMs * 1000)
    expectCritical(run, /o prazo de \d+ s do hook acabou/)
  })
})

describe.concurrent(
  'the loop files by the repository they belong to (Copilot review of #26)',
  () => {
    let worktree: { dir: string; gitDir: string }
    let nowhere: string
    let broken: string

    beforeAll(async () => {
      worktree = await onMain.addWorktree('wt-arquivos', 'feature/9-arquivos')
      nowhere = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'guard-bash-nowhere-')),
      )
      // A directory where git fails instead of saying "not a repository":
      // its .git is a file git cannot read.
      broken = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'guard-bash-broken-')),
      )
      writeFileSync(path.join(broken, '.git'), 'não é um gitdir\n')
    }, setupTimeout)

    afterAll(() => {
      for (const dir of [nowhere, broken])
        if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it.each([
      [
        'another repository’s settings.local.json',
        () => `echo x > ${elsewhere.dir}/.claude/settings.local.json`,
      ],
      [
        'another repository’s loop-gate.json',
        () => `echo x > ${elsewhere.gitDir}/loop-gate.json`,
      ],
      [
        'another repository’s plan marker',
        () => `rm -f ${elsewhere.gitDir}/loop-plan-pending-sessao-1.json`,
      ],
      [
        'a settings.local.json in no repository',
        () => `echo x > ${nowhere}/.claude/settings.local.json`,
      ],
    ])('passes %s', async (_, text) => {
      expectPass(await guard(text()))
    })

    it.each([
      [
        'the main checkout’s settings.local.json',
        () => `echo x > ${onMain.dir}/.claude/settings.local.json`,
        /saída de emergência do dono/,
      ],
      [
        'a worktree’s settings.local.json',
        () => `echo x > ${worktree.dir}/.claude/settings.local.json`,
        /saída de emergência do dono/,
      ],
      [
        'a worktree’s loop-gate.json',
        () => `echo x > ${worktree.gitDir}/loop-gate.json`,
        /só o gate e os hooks escrevem/,
      ],
      [
        'a plan marker in the common git dir',
        () => `rm -f ${onMain.gitDir}/loop-plan-pending-sessao-1.json`,
        /só o gate e os hooks escrevem/,
      ],
      [
        'a path it cannot resolve',
        () => `echo x > "$D/.claude/settings.local.json"`,
        /saída de emergência do dono/,
      ],
    ])('denies %s, from another repository', async (_, text, reason) => {
      expectDeny(await guard(text(), { repo: elsewhere }), reason)
    })

    it.each([
      [
        'settings.local.json',
        () => `echo x > ${broken}/.claude/settings.local.json`,
        /saída de emergência do dono/,
      ],
      [
        'loop-gate.json',
        () => `echo x > ${broken}/loop-gate.json`,
        /só o gate e os hooks escrevem/,
      ],
    ])(
      'denies %s by its name where git cannot say whose it is',
      async (_, text, reason) => {
        expectDeny(await guard(text()), reason)
      },
    )

    it('keeps the user’s own settings as they were, in a home that is another repository', async () => {
      // A home directory under git, as the owner's is: the files Claude Code
      // reads there for every session are not another repository's.
      const env = feature.env({ HOME: elsewhere.dir })
      expectDeny(
        await guard('echo x > ~/.claude/settings.local.json', { env }),
        /saída de emergência do dono/,
      )
      expectPass(await guard('echo x > ~/.claude/settings.json', { env }))
      expectDeny(
        await guard(`echo x > ${elsewhere.dir}/cfg/settings.local.json`, {
          env: feature.env({
            HOME: elsewhere.dir,
            CLAUDE_CONFIG_DIR: `${elsewhere.dir}/cfg`,
          }),
        }),
        /saída de emergência do dono/,
      )
    })
  },
)

describe.concurrent(
  'what it cannot read is refused in auto (Copilot review of #26, third round)',
  () => {
    it.each([
      ['a commit message behind an expansion', 'git commit -m "$MSG"'],
      ['a merge message file behind an expansion', 'git merge -F "$FILE" main'],
      ['a label behind an expansion', 'gh issue create -t T -b c -l "$LABEL"'],
      [
        'a PR title behind an expansion',
        `gh pr create --title "$TITLE" --body 'Closes #5.'`,
      ],
      [
        'an --input of the labels endpoint it cannot read',
        'gh api repos/geazioliveira/marketo-sandbox/issues/5/labels --input "$BODY"',
      ],
      [
        'a REST state behind an expansion',
        'gh api -X PATCH repos/geazioliveira/marketo-sandbox/issues/5 -f state="$STATE"',
      ],
      ['a line it cannot read whole', 'gh issue comment 5 --body "sem fim'],
    ])('asks for %s, and denies it in auto', async (_, text) => {
      expectAsk(await guard(text))
      expectDeny(
        await guard(text, { mode: 'auto' }),
        /Em auto, a confirmação vira negação/,
      )
    })

    it.each([
      [
        'a commit message in "$(cat <<\'EOF\' … EOF)"',
        `git commit -m "$(cat <<'EOF'\nHooks do loop.\n\nRefs #5\nEOF\n)"`,
      ],
      [
        'a commit message from a heredoc',
        "git commit -F - <<'MSG'\nHooks\nMSG",
      ],
      [
        'a PR body in "$(cat <<\'EOF\' … EOF)"',
        `gh pr create --title "Hooks do loop" --body "$(cat <<'EOF'\nCloses #5.\n\nTexto.\nEOF\n)"`,
      ],
      [
        'a title the line assigned',
        `T='Hooks do loop'; gh pr create --title "$T" --body 'Closes #5.'`,
      ],
    ])('passes %s, in auto too', async (_, text) => {
      expectPass(await guard(text))
      expectPass(await guard(text, { mode: 'auto' }))
    })

    test('reads GH_HOST exported earlier on the line', async ({ live }) => {
      const gh = live({})
      expectPass(
        await guard('export GH_HOST=ghe.example.com; gh issue reopen 5', {
          env: gh.env,
        }),
      )
      expectPass(
        await guard(
          'GH_HOST=ghe.example.com GH_REPO=geazioliveira/marketo-sandbox gh issue edit 5 --remove-label needs-triage --add-label ready-for-human',
          { env: gh.env },
        ),
      )
      expect(gh.calls()).toEqual([])
      expectDeny(
        await guard('export GH_HOST="$H"; gh issue reopen 5', { env: gh.env }),
        /reabrir uma issue/,
      )
      expectDeny(
        await guard(
          'GH_HOST=$H gh issue edit 5 --remove-label needs-triage --add-label ready-for-human',
          { env: gh.env, mode: 'auto' },
        ),
        /não consegui ler em que repositório/,
      )
      expect(gh.calls()).toEqual([])
    })

    test('reads GH_HOST inherited from the session', async ({ live }) => {
      const gh = live({}, { GH_HOST: 'ghe.example.com' })
      expectPass(await guard('gh issue reopen 5', { env: gh.env }))
      expect(gh.calls()).toEqual([])
    })

    it('reads a message file the line writes, named through a variable assigned after cd &&', async () => {
      const head = `cd "${feature.dir}" && S="${feature.root}/rascunho" && cat > "$S/msg.txt" <<'EOF'`
      const tail = 'git add -A && git commit -q -F "$S/msg.txt"'
      expectPass(
        await guard(`${head}\nHooks do loop.\n\nRefs #5\nEOF\n${tail}`, {
          mode: 'auto',
        }),
      )
      expectDeny(
        await guard(`${head}\nHooks [skip ci]\nEOF\n${tail}`),
        /a mensagem do commit traz "\[skip ci\]"/,
      )
    })

    it.each([
      ['a path behind an expansion', 'echo x > "$OUT"'],
      [
        'a relative path after a cd it cannot read',
        'cd "$D" && echo x > saida.txt',
      ],
      [
        'a loop variable over a glob',
        "for f in *.md; do sed -i '' 's/x/y/' \"$f\"; done",
      ],
      [
        'a loop variable the body reassigns',
        'for f in a.md b.md; do f=".claude/$f"; echo x > "$f"; done',
      ],
      ['a copy into a directory behind an expansion', 'cp a.txt "$DEST"/'],
    ])('asks for a write to %s, and denies it in auto', async (_, text) => {
      expectAsk(await guard(text), /não consegui ler onde o comando escreve/)
      expectDeny(
        await guard(text, { mode: 'auto' }),
        /Em auto, a confirmação vira negação/,
      )
    })

    it.each([
      [
        'a variable assigned earlier in the same && list',
        'git status && SP=/tmp/rascunho && npm run check > $SP/check.log 2>&1',
      ],
      [
        'a variable the line assigned, after `while IFS= read`',
        'S=/tmp/rascunho\n( while IFS= read -r f; do echo "$f"; done < lista.txt ); rm -rf "$S/copia"',
      ],
      ['a path with the process id', 'echo x > /tmp/copia.$$'],
      [
        'an absolute path after a cd it cannot read',
        'cd "$D" && echo x > /tmp/saida.txt',
      ],
      ['a variable the line assigned', 'O=/tmp/saida.txt; echo x > "$O"'],
      [
        'a loop variable over values written in full',
        'S=/tmp/rascunho; for i in 1 2; do npx vitest run > "$S/vitest-$i.txt" 2>&1; done',
      ],
      [
        'a copy named by a loop variable, the way a session restores files',
        'for k in identity mapi; do cp "/tmp/main/docs/swagger-$k.json" "docs/swagger-$k.json"; done',
      ],
    ])('passes a write to %s', async (_, text) => {
      expectPass(await guard(text, { mode: 'auto' }))
    })

    it('reads each value of a loop where the write lands, a protected one included', async () => {
      expectDeny(
        await guard(
          'for f in settings.json settings.local.json; do echo x > ".claude/$f"; done',
        ),
        /saída de emergência do dono/,
      )
    })

    it('denies git push --repo <this project> HEAD:main', async () => {
      expectDeny(
        await guard(
          'git push --repo https://github.com/geazioliveira/marketo-sandbox.git HEAD:main',
        ),
        /push em main/,
      )
    })
  },
)

describe.concurrent(
  'what the programs of the line run, when it cannot be read, is refused in auto (Copilot review of #26, third round)',
  () => {
    let dir = ''

    beforeAll(() => {
      dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'guard-bash-')))
      writeFileSync(
        path.join(dir, 'inteiro.sh'),
        'gh issue comment 5 --body "sem fim\n',
      )
      // Each script runs the next: nine levels, past the hook's depth.
      for (let k = 0; k < 9; k += 1)
        writeFileSync(
          path.join(dir, `nivel-${k}.sh`),
          `sh ${path.join(dir, `nivel-${k + 1}.sh`)}\n`,
        )
      writeFileSync(path.join(dir, 'nivel-9.sh'), 'gh issue list\n')
    })

    afterAll(() => {
      if (dir !== '') rmSync(dir, { recursive: true, force: true })
    })

    it.each([
      [
        'a script file it cannot read whole',
        () => `sh ${path.join(dir, 'inteiro.sh')}`,
        /não consegui ler inteiro o script que o comando roda/,
      ],
      [
        'the -c script of a program it cannot name',
        () => '"$SH" -o view -c "$X gh issue list"',
        /como sh: não consegui ler o script que o sh roda/,
      ],
      [
        'the stdin script of a program it cannot name',
        () => '"$SH" <<EOF\n$X gh issue list\nEOF',
        /como sh: não consegui ler o script que o sh lê do stdin/,
      ],
      [
        'parallel',
        () => 'parallel gh issue reopen ::: 1 2',
        /o parallel monta comandos que o hook não lê/,
      ],
      [
        'scripts nested past the hook’s depth',
        () => `sh ${path.join(dir, 'nivel-0.sh')}`,
        /comandos dentro de comandos demais/,
      ],
    ])('asks for %s, and denies it in auto', async (_, text, reason) => {
      expectAsk(await guard(text()), reason)
      expectDeny(await guard(text(), { mode: 'auto' }), reason)
    })
  },
)

// ---------------------------------------------------------------------------
// Fourth round of Copilot's review of #26

describe.concurrent(
  'git writes to the worktree go through the gate (Copilot review of #26, fourth round)',
  () => {
    /**
     * This project's main checkout, and a linked worktree beside it on a
     * branch of #5, as the session works: the gate ran there and is closed.
     * git-rules.spec.ts covers each subcommand; here are the probe Copilot
     * ran, end to end, the session's plan marker, and the modes.
     */
    let base: HookRepo
    let worktree: { dir: string; gitDir: string }
    const SESSION = 'sessao-das-escritas'

    const writeCache = (gitDir: string, open: boolean) =>
      writeFileSync(
        path.join(gitDir, gateCacheFile),
        `${JSON.stringify({
          schema: gateCacheSchema,
          repo: 'geazioliveira/marketo-sandbox',
          branch: FEATURE,
          issue: 5,
          headSha: HEAD,
          open,
          verified: true,
          steps: [],
          checkedAt: new Date().toISOString(),
        })}\n`,
      )

    beforeAll(async () => {
      base = await hookRepo()
      worktree = await base.addWorktree('wt-5', FEATURE)
      writeCache(worktree.gitDir, false)
    }, setupTimeout)

    afterAll(() => base?.remove(), setupTimeout)

    const probe = (command: string, mode: string, cwd = worktree.dir) =>
      base.run(
        'guard-bash',
        {
          session_id: SESSION,
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command },
          permission_mode: mode,
          cwd,
        },
        { cwd },
      )

    it.each(['default', 'auto'])(
      'does not pass the probe Copilot ran, git checkout -- README.md on a feature/5-* worktree with the gate closed (%s)',
      async (mode) => {
        expectDeny(
          await probe('git checkout -- README.md', mode),
          /o git checkout escreve no worktree \(README\.md\): o gate está fechado/,
        )
        // The same from the main checkout, through a cd.
        expectDeny(
          await probe(
            `cd ${worktree.dir} && git checkout -- README.md`,
            mode,
            base.dir,
          ),
          /o gate está fechado/,
        )
      },
    )

    it.each(['default', 'auto'])(
      'passes a switch of branch and a write of the intent alone with the gate closed (%s)',
      async (mode) => {
        for (const command of [
          'git fetch origin',
          'git switch -c feature/9-x',
          'git checkout -- context/intent/feature-x.md',
        ])
          expectPass(await probe(command, mode))
      },
    )

    it('asks, and denies in auto, a write with this session’s plan not yet posted', async () => {
      const other = await hookRepo()
      try {
        const wt = await other.addWorktree('wt-5', FEATURE)
        writeCache(wt.gitDir, true)
        const run = (mode: string) =>
          other.run(
            'guard-bash',
            {
              session_id: SESSION,
              hook_event_name: 'PreToolUse',
              tool_name: 'Bash',
              tool_input: { command: 'git restore README.md' },
              permission_mode: mode,
              cwd: wt.dir,
            },
            { cwd: wt.dir },
          )
        expectPass(await run('default'))
        // The marker lives in the common git dir, which the worktree shares.
        other.writeMarker(SESSION)
        expectAsk(await run('default'), /plano aceito nesta sessão/)
        expectDeny(await run('auto'), /Em auto, a confirmação vira negação/)
      } finally {
        other.remove()
      }
    })
  },
)

// ---------------------------------------------------------------------------
// Sixth round of Copilot's review of #26

describe.concurrent(
  'the sixth round of Copilot’s review of #26, end to end',
  () => {
    const modes = ['default', 'auto'] as const

    it.each(modes)(
      'denies gh api fields beside --input that reopen the issue, in %s',
      async (mode) => {
        feature.write({ 'body.json': '{"title": "Novo título"}\n' })
        expectDeny(
          await guard(
            'gh api -X PATCH repos/geazioliveira/marketo-sandbox/issues/5 --input body.json -f state=open',
            { mode },
          ),
          /reabrir uma issue.*query string/,
        )
      },
    )

    it.each(modes)(
      'passes gh api fields beside --input that no rule reads, in %s',
      async (mode) => {
        feature.write({ 'body.json': '{"title": "Novo título"}\n' })
        expectPass(
          await guard(
            'gh api -X PATCH repos/geazioliveira/marketo-sandbox/issues/5 --input body.json -f title=Outro',
            { mode },
          ),
        )
      },
    )

    it.each(modes)('denies git update-ref of main, in %s', async (mode) => {
      expectDeny(
        await guard(`git update-ref refs/heads/main ${feature.headSha}`, {
          mode,
        }),
        /mover main fora de uma PR/,
      )
    })

    it.each(modes)(
      'passes git update-ref of a branch of the issue, in %s',
      async (mode) => {
        expectPass(
          await guard(
            `git update-ref refs/heads/feature/9-outra ${feature.headSha}`,
            { mode },
          ),
        )
      },
    )

    // In a clone of another repository the command would pass; a GIT_DIR it
    // cannot read may name this project, whose state labels are the owner's.
    it.each(modes)(
      'judges gh with a GIT_DIR it cannot read as this project, from a clone of another repository, in %s',
      async (mode) => {
        expectPass(
          await guard('gh issue edit 5 --add-label ready-for-agent', {
            repo: elsewhere,
            mode,
          }),
        )
        expectDeny(
          await guard(
            'GIT_DIR=$X gh issue edit 5 --add-label ready-for-agent',
            { repo: elsewhere, mode },
          ),
          /ready-for-agent são do dono/,
        )
      },
    )

    it('asks for update-ref --stdin fed by a pipe, and denies it in auto', async () => {
      const line = `printf 'update refs/heads/main ${feature.headSha}\\n' | git update-ref --stdin`
      expectAsk(await guard(line), /update-ref --stdin lê as refs do stdin/)
      expectDeny(
        await guard(line, { mode: 'auto' }),
        /Em auto, a confirmação vira negação/,
      )
    })
  },
)

// ---------------------------------------------------------------------------
// Seventh round of Copilot's review of #26

describe.concurrent(
  'the git config a gh command gives git (Copilot review of #26, seventh round)',
  () => {
    const modes = ['default', 'auto'] as const
    const project = 'https://github.com/geazioliveira/marketo-sandbox.git'
    const other = 'https://github.com/alguem/outro.git'
    const transition =
      'gh issue edit 5 --remove-label needs-triage --add-label ready-for-human'
    /** The example of the review, word for word. */
    const example = `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=${project} ${transition}`
    /** git config that sends the other clone's origin to this project. */
    const redirect = `[url "${project}"]\n\tinsteadOf = ${other}\n`
    const redirectVars = `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.${project}.insteadOf GIT_CONFIG_VALUE_0=${other}`
    const inPlan = () => ({
      issues: {
        5: {
          labels: ['enhancement', 'needs-triage'],
          lastCommentBody: '# Plano\n\n## Contexto e porquê\n\nTexto.',
        },
      },
    })
    const unknownTransition =
      /não consegui ler em que repositório o comando troca needs-triage por ready-for-human \(o comando dá ao git uma configuração própria/

    /** A dir of its own for the config files a case writes, removed after it. */
    const configDir = (files: Record<string, string>) => {
      const dir = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'guard-bash-config-')),
      )
      for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        writeFileSync(path.join(dir, file), content)
      }
      return dir
    }

    /** The label exception with a target it cannot read: a critical ask, a deny in auto, nothing read live. */
    function expectUnknownTransition(
      run: HookRun,
      mode: string,
      calls: () => GhCall[],
      why?: RegExp,
    ) {
      if (mode === 'auto') {
        expectDeny(run, /Em auto, a confirmação vira negação/)
      } else expectAsk(run)
      expect(reasonOf(run)).toMatch(unknownTransition)
      if (why !== undefined) expect(reasonOf(run)).toMatch(why)
      expect(calls()).toEqual([])
    }

    test.for(modes)(
      'the example of the review, from a clone of another repository: the target is unknown, in %s',
      async (mode, { live }) => {
        const gh = live(inPlan())
        expectUnknownTransition(
          await guard(example, { repo: elsewhere, env: gh.env, mode }),
          mode,
          gh.calls,
          /GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0\), e o origin aponta para mais de um repositório/,
        )
      },
    )

    test.for(modes)(
      'the example of the review, from a clone of this project: read live and passed, as today, in %s',
      async (mode, { live }) => {
        const gh = live(inPlan())
        expectPass(await guard(example, { env: gh.env, mode }))
        expect(gh.calls()).toEqual([
          expect.objectContaining({ call: 'issueState', key: '5', mode: 'ok' }),
        ])
      },
    )

    test.for(modes)(
      'gh pr merge with the variables of the example, from a clone of another repository: reads nothing and says why, in %s',
      async (mode, { live }) => {
        const gh = live({ prs: { 26: { pr: readyPr({ number: 26 }) } } })
        const vars = example.slice(0, example.length - transition.length)
        // Without the variables, the merge is another repository's: it passes.
        expectPass(
          await guard('gh pr merge 26', { repo: elsewhere, env: gh.env, mode }),
        )
        const run = await guard(`${vars}gh pr merge 26`, {
          repo: elsewhere,
          env: gh.env,
          mode,
        })
        if (mode === 'auto')
          expectDeny(run, /Em auto, a confirmação vira negação/)
        else expectAsk(run)
        expect(reasonOf(run)).toMatch(
          /não consegui ler o estado da PR \(o repositório da PR não pôde ser lido \(o comando dá ao git uma configuração própria \(GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0\), e o origin aponta para mais de um repositório\)\)/,
        )
        expect(gh.calls()).toEqual([])
      },
    )

    test.for(modes)(
      'a label the agent never adds, from a clone of another repository sent to this project: denied, in %s',
      async (mode) => {
        expectDeny(
          await guard(
            `${redirectVars} gh issue edit 5 --add-label ready-for-agent`,
            { repo: elsewhere, mode },
          ),
          /ready-for-agent são do dono/,
        )
      },
    )

    test.for(modes)(
      'each variable that moves git’s config, from a clone of another repository: the target is unknown, in %s',
      async (mode, { live }) => {
        const files = configDir({
          'redirect.cfg': redirect,
          'resolved.cfg': `[remote "origin"]\n\tgh-resolved = geazioliveira/marketo-sandbox\n`,
          'home/.gitconfig': redirect,
          'xdg/git/config': redirect,
        })
        try {
          const cases: [string, Record<string, string | null>, RegExp][] = [
            [redirectVars, {}, /reescreve URLs/],
            [
              `GIT_CONFIG_PARAMETERS="'url.${project}.insteadof'='${other}'"`,
              {},
              /GIT_CONFIG_PARAMETERS\), e ela reescreve URLs/,
            ],
            [
              `GIT_CONFIG_GLOBAL=${files}/redirect.cfg`,
              {},
              /GIT_CONFIG_GLOBAL\), e ela reescreve URLs/,
            ],
            [
              `GIT_CONFIG_NOSYSTEM=0 GIT_CONFIG_SYSTEM=${files}/redirect.cfg`,
              {},
              /GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM\), e ela reescreve URLs/,
            ],
            // The hook inherits a system config it does not read; the
            // command turns it on.
            [
              'GIT_CONFIG_NOSYSTEM=0',
              { GIT_CONFIG_SYSTEM: `${files}/redirect.cfg` },
              /GIT_CONFIG_NOSYSTEM\), e ela reescreve URLs/,
            ],
            [
              `GIT_CONFIG=${files}/resolved.cfg`,
              {},
              /GIT_CONFIG leva o git config que o gh roda a outro arquivo/,
            ],
            // HOME and XDG_CONFIG_HOME count where GIT_CONFIG_GLOBAL does
            // not replace them, as outside the specs.
            [
              `HOME=${files}/home`,
              { GIT_CONFIG_GLOBAL: null },
              /\(HOME\), e ela reescreve URLs/,
            ],
            [
              `XDG_CONFIG_HOME=${files}/xdg`,
              { GIT_CONFIG_GLOBAL: null },
              /\(XDG_CONFIG_HOME\), e ela reescreve URLs/,
            ],
          ]
          for (const [vars, inherited, why] of cases) {
            const gh = live(inPlan())
            const env = { ...gh.env }
            for (const [name, value] of Object.entries(inherited))
              if (value === null) delete env[name]
              else env[name] = value
            // Without the variable, the other clone passes: what changes
            // the verdict is the config the command gives git.
            expectPass(await guard(transition, { repo: elsewhere, env, mode }))
            expectUnknownTransition(
              await guard(`${vars} ${transition}`, {
                repo: elsewhere,
                env,
                mode,
              }),
              mode,
              gh.calls,
              why,
            )
          }
        } finally {
          rmSync(files, { recursive: true, force: true })
        }
      },
    )

    test.for(modes)(
      'the variables exported earlier on the line, or assigned there, count as on the command, in %s',
      async (mode, { live }) => {
        const files = configDir({ 'home/.gitconfig': redirect })
        try {
          for (const line of [
            `export ${redirectVars}; ${transition}`,
            `export ${redirectVars} && ${transition}`,
            `HOME=${files}/home; ${transition}`,
            `declare HOME=${files}/home; ${transition}`,
          ]) {
            const gh = live(inPlan())
            expectUnknownTransition(
              await guard(line, { repo: elsewhere, env: gh.env, mode }),
              mode,
              gh.calls,
            )
          }
        } finally {
          rmSync(files, { recursive: true, force: true })
        }
      },
    )

    test.for(modes)(
      'env that takes the config’s variables out of the command: the target is unknown, in %s',
      async (mode, { live }) => {
        for (const wrapper of [
          'env -u HOME',
          'env --unset=GIT_CONFIG_GLOBAL',
          'env -i PATH=/usr/bin:/bin',
          'env - PATH=/usr/bin:/bin',
        ]) {
          const gh = live(inPlan())
          expectUnknownTransition(
            await guard(`${wrapper} ${transition}`, {
              repo: elsewhere,
              env: gh.env,
              mode,
            }),
            mode,
            gh.calls,
            /fica vazia ou deixa de existir/,
          )
        }
      },
    )

    test.for(modes)(
      'env with a lone -, read as -i, still runs the gh the rules judge, in %s',
      async (mode) => {
        expectDeny(
          await guard('env - gh issue reopen 5', { mode }),
          /reabrir uma issue/,
        )
        expectDeny(
          await guard('env - PATH=/usr/bin gh issue reopen 5', { mode }),
          /reabrir uma issue/,
        )
      },
    )

    test.for(modes)(
      'a value it cannot read, or a config git refuses: the target is unknown, in %s',
      async (mode, { live }) => {
        for (const [vars, why] of [
          [
            'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=$URL',
            /GIT_CONFIG_VALUE_0 traz uma expansão/,
          ],
          [
            'GIT_CONFIG_GLOBAL="$(mktemp)"',
            /GIT_CONFIG_GLOBAL traz uma expansão/,
          ],
          ['export HOME;', /HOME traz uma expansão/],
          ['unset HOME;', /não sei se HOME fica vazia ou deixa de existir/],
          [
            'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=Outro',
            /o git recusou essa configuração/,
          ],
        ] as const) {
          const gh = live(inPlan())
          expectUnknownTransition(
            await guard(`${vars} ${transition}`, {
              repo: elsewhere,
              env: gh.env,
              mode,
            }),
            mode,
            gh.calls,
            why,
          )
        }
      },
    )

    test.for(modes)(
      'a config it reads in full, that leaves the other repository, still passes there, in %s',
      async (mode) => {
        for (const vars of [
          'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=Outro',
          `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=${other}`,
          `HOME=${elsewhere.env().HOME}`,
        ])
          expectPass(
            await guard(`${vars} gh issue edit 5 --add-label ready-for-agent`, {
              repo: elsewhere,
              mode,
            }),
          )
      },
    )

    test.for(modes)(
      'a gh api placeholder filled from such a config is not filled with the other repository, in %s',
      async (mode) => {
        const line = `gh api -X POST 'repos/{owner}/{repo}/issues/5/labels' -f 'labels[]=ready-for-agent'`
        expectPass(await guard(line, { repo: elsewhere, mode }))
        expectDeny(
          await guard(`${redirectVars} ${line}`, { repo: elsewhere, mode }),
          /o agente não escreve label de estado por gh api/,
        )
      },
    )

    test.for(modes)(
      'a remote an earlier command of the line changed is not read again from the disk, in %s',
      async (mode, { live }) => {
        const gh = live(inPlan())
        expectUnknownTransition(
          await guard(
            `git remote set-url origin ${other} && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=Outro ${transition}`,
            { repo: elsewhere, env: gh.env, mode },
          ),
          mode,
          gh.calls,
          /um comando anterior da linha mudou os remotes/,
        )
      },
    )
  },
)

// ---------------------------------------------------------------------------
// Eighth round of Copilot's review of #26

describe.concurrent(
  'writes through links, on disk or made earlier on the line (Copilot review of #26, eighth round)',
  () => {
    // A repository of its own, whose escape hatch exists on disk, and a
    // directory under no repository that holds links into it.
    let linked: HookRepo
    let links = ''
    const at = (name: string) => path.join(links, name)
    const hatch = /saída de emergência do dono/
    const loopFile = /só o gate e os hooks escrevem/
    const harness = /caminho do harness: confira/
    const inGitDir = /dentro do diretório git/
    const opening = /não abre como Approve/

    beforeAll(async () => {
      linked = await hookRepo({ branch: FEATURE, cache: true })
      linked.write({
        '.claude/settings.local.json': '{}\n',
        'body.md': 'Recado.\n',
      })
      links = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'guard-bash-links-')),
      )
      const inRepo = (name: string) => path.join(linked.dir, name)
      symlinkSync(inRepo('.claude/settings.local.json'), at('hatch'))
      symlinkSync(path.join(linked.gitDir, gateCacheFile), at('gate'))
      // Dangling: no marker exists, and a write through the link makes one.
      symlinkSync(
        path.join(linked.gitDir, planPendingFile('sessao-1')),
        at('marker'),
      )
      symlinkSync(path.join(linked.gitDir, 'HEAD'), at('head'))
      symlinkSync(inRepo('.claude'), at('claude'))
      // Dangling harness paths: the repository has neither.
      symlinkSync(inRepo('.github/workflows/novo.yml'), at('workflow'))
      symlinkSync(inRepo('scripts/gate.mjs'), at('gate-script'))
      // A chain, its last link relative to its own directory.
      symlinkSync('hatch', at('chain2'))
      symlinkSync(at('chain2'), at('chain1'))
      symlinkSync(at('loop-b'), at('loop-a'))
      symlinkSync(at('loop-a'), at('loop-b'))
      symlinkSync(inRepo('README.md'), at('readme'))
      symlinkSync(inRepo('body.md'), at('body-link'))
      writeFileSync(at('alvo.txt'), 'Nada do loop.\n')
      symlinkSync(at('alvo.txt'), at('unrelated'))
      // Ninth: a link inside .claude that leads out of the repository, a
      // link to a directory, a body on disk that opens as the Approve, and a
      // script whose loop gives PWD a value the line does not spell.
      symlinkSync(at('alvo.txt'), inRepo('.claude/fora'))
      mkdirSync(at('pasta'))
      writeFileSync(path.join(at('pasta'), 'f.md'), 'Recado.\n')
      symlinkSync(at('pasta'), at('pasta-link'))
      mkdirSync(at('aprova-dir'))
      writeFileSync(path.join(at('aprova-dir'), 'f.md'), '# Owner Approve\n')
      // Links to that directory, named as a plan marker and inside the git
      // dir: what they lead to is no file of the loop, but they are.
      symlinkSync(at('pasta'), inRepo(`.claude/${planPendingFile('sessao-2')}`))
      symlinkSync(at('pasta'), path.join(linked.gitDir, 'pasta-link'))
      writeFileSync(at('aprova.md'), '# Owner Approve\n')
      symlinkSync(at('aprova.md'), at('aprova-link'))
      writeFileSync(
        at('muda-pwd.sh'),
        'for PWD in /tmp; do echo x > "$PWD/.claude/settings.json"; done\n',
      )
    }, setupTimeout)

    afterAll(() => {
      linked?.remove()
      if (links) rmSync(links, { recursive: true, force: true })
    }, setupTimeout)

    const run = (line: string, mode = 'default') =>
      guard(line, { repo: linked, mode })

    /** Refused in every mode. */
    const denies = async (line: string, reason: RegExp) => {
      const [plain, auto] = await Promise.all([run(line), run(line, 'auto')])
      expectDeny(plain, reason)
      expectDeny(auto, reason)
    }

    /** Asked, critical: a person confirms it, and auto refuses it. */
    const asksCritical = async (line: string, reason: RegExp) => {
      const [plain, auto] = await Promise.all([run(line), run(line, 'auto')])
      expectAsk(plain, reason)
      expectDeny(auto, reason)
      expect(reasonOf(auto)).toMatch(/Em auto, a confirmação vira negação/)
    }

    const passes = async (line: string) => {
      const [plain, auto] = await Promise.all([run(line), run(line, 'auto')])
      expectPass(plain)
      expectPass(auto)
    }

    it.each([
      // On disk: each link was there before the line.
      [
        'a link to the escape hatch',
        () => `echo '{"disableAllHooks":true}' > ${at('hatch')}`,
        hatch,
      ],
      [
        'a link to the gate cache, appended',
        () => `echo x >> ${at('gate')}`,
        loopFile,
      ],
      [
        'a dangling link to a plan marker',
        () => `echo '{}' > ${at('marker')}`,
        loopFile,
      ],
      [
        'a chain of links, the last one relative to its directory',
        () => `printf x > ${at('chain1')}`,
        hatch,
      ],
      ['tee through a link', () => `echo '{}' | tee ${at('hatch')}`, hatch],
      ['cp onto a link', () => `cp /tmp/x ${at('gate')}`, loopFile],
      ['mv onto a link', () => `mv /tmp/x ${at('hatch')}`, hatch],
      [
        'install onto a link',
        () => `install -m 644 /tmp/x ${at('gate')}`,
        loopFile,
      ],
      ['rsync onto a link', () => `rsync -a /tmp/x ${at('hatch')}`, hatch],
      ['dd onto a link', () => `dd if=/dev/null of=${at('gate')}`, loopFile],
      [
        'truncate of a dangling link',
        () => `truncate -s 0 ${at('marker')}`,
        loopFile,
      ],
      [
        'sed -i through a link',
        () => `sed -i '' 's/a/b/' ${at('hatch')}`,
        hatch,
      ],
      // Made earlier on the same line: not on disk while the hook reads it.
      [
        'a link to the escape hatch made on the line',
        () =>
          `ln -s "$PWD/.claude/settings.local.json" ${at('novo-hatch')} && echo '{"disableAllHooks":true}' > ${at('novo-hatch')}`,
        hatch,
      ],
      [
        'a link to the gate cache made on the line',
        () =>
          `ln -s "$PWD/.git/${gateCacheFile}" ${at('novo-gate')} && echo x > ${at('novo-gate')}`,
        loopFile,
      ],
      [
        'a link to a plan marker made with ln -sfn',
        () =>
          `ln -sfn "$PWD/.git/${planPendingFile('sessao-1')}" ${at('novo-marker')} && echo '{}' > ${at('novo-marker')}`,
        loopFile,
      ],
      [
        'a link ln -r makes from the cwd',
        () =>
          `ln -sr .claude/settings.local.json ${at('novo-r')} && echo x > ${at('novo-r')}`,
        hatch,
      ],
      [
        'a link placed in a directory, under the source’s name',
        () =>
          `ln -s "$PWD/.claude/settings.local.json" ${links} && echo x > ${at('settings.local.json')}`,
        hatch,
      ],
      [
        'a link placed with -t',
        () =>
          `ln -st ${links} "$PWD/.claude/settings.local.json" && echo x > ${at('settings.local.json')}`,
        hatch,
      ],
      [
        'a relative link read from its own directory',
        () => `ln -s hatch ${at('novo-rel')} && echo x > ${at('novo-rel')}`,
        hatch,
      ],
      [
        'a chain made on the line',
        () =>
          `ln -s "$PWD/.claude/settings.local.json" ${at('c1')} && ln -s ${at('c1')} ${at('c2')} && echo x > ${at('c2')}`,
        hatch,
      ],
      [
        'a symbolic link made by cp -s',
        () =>
          `cp -s "$PWD/.claude/settings.local.json" ${at('novo-cs')} && echo x > ${at('novo-cs')}`,
        hatch,
      ],
      [
        'a link copied as a link by cp -P',
        () => `cp -P ${at('hatch')} ${at('copia')} && echo x > ${at('copia')}`,
        hatch,
      ],
      [
        'a link the line made, copied as a link',
        () =>
          `ln -s "$PWD/.claude/settings.local.json" ${at('p1')} && cp -P ${at('p1')} ${at('p2')} && echo x > ${at('p2')}`,
        hatch,
      ],
      [
        'a directory copied with a link the line made inside',
        () =>
          `mkdir ${at('d1')} && ln -s "$PWD/.claude/settings.local.json" ${at('d1')}/l && cp -R ${at('d1')} ${at('d2')} && echo x > ${at('d2')}/l`,
        hatch,
      ],
      [
        'ln -sf over an existing link',
        () =>
          `ln -sf "$PWD/.claude/settings.local.json" ${at('unrelated')} && echo x > ${at('unrelated')}`,
        hatch,
      ],
      // Hard links: the new name is the same file, so making one is
      // writing the file, and so is writing through it.
      [
        'a hard link to the escape hatch',
        () => `ln .claude/settings.local.json ${at('h1')}`,
        hatch,
      ],
      [
        'a write through a hard link made on the line',
        () => `ln .git/${gateCacheFile} ${at('h2')} ; echo x > ${at('h2')}`,
        loopFile,
      ],
      ['link(1)', () => `link .git/${gateCacheFile} ${at('h3')}`, loopFile],
      ['cp -l', () => `cp -l .claude/settings.local.json ${at('h4')}`, hatch],
      [
        'rsync --link-dest into the directory of the escape hatch',
        () => `rsync -a --link-dest="$PWD/.claude" /tmp/x/ ${at('bk')}/`,
        /contém .claude\/settings.local.json/,
      ],
      // A source it cannot read, whose text names a file of the loop, is
      // judged by that name, as a write to such a path is.
      [
        'a link whose source it cannot read, naming the gate cache',
        () =>
          `ln -s "$(git rev-parse --git-dir)/${gateCacheFile}" ${at('u1')} && echo x > ${at('u1')}`,
        loopFile,
      ],
    ])('denies %s', async (_, line, reason) => {
      await denies(line(), reason)
    })

    it.each([
      [
        'a dangling link to a harness file',
        () => `echo x > ${at('gate-script')}`,
        harness,
      ],
      [
        'a dangling link to a workflow',
        () => `echo x > ${at('workflow')}`,
        harness,
      ],
      [
        'a link to a file of the git dir',
        () => `echo x > ${at('head')}`,
        inGitDir,
      ],
      [
        'a symlinked directory that holds the harness',
        () => `cp /tmp/x ${at('claude')}/hooks/novo.mjs`,
        harness,
      ],
      [
        'a loop of links',
        () => `echo x > ${at('loop-a')}`,
        /link simbólico que não consegui seguir/,
      ],
      [
        'a link to the git dir made on the line',
        () =>
          `ln -s "$PWD/.git" ${at('novo-git')} && echo x > ${at('novo-git')}/HEAD`,
        inGitDir,
      ],
      [
        'a link to .claude made on the line',
        () =>
          `ln -s "$PWD/.claude" ${at('novo-claude')} && cp /tmp/x ${at('novo-claude')}/hooks/guard-bash.mjs`,
        harness,
      ],
      [
        'a link to .github made on the line',
        () =>
          `ln -sf "$PWD/.github" ${at('novo-github')} && echo x > ${at('novo-github')}/workflows/ci.yml`,
        harness,
      ],
      [
        'a hard link to a harness file',
        () => `ln .claude/hooks/x.mjs ${at('h5')}`,
        harness,
      ],
      [
        'a write through a link whose source it cannot read',
        () => `ln -s "$ALVO" ${at('u2')} && echo x > ${at('u2')}`,
        /aonde leva o link/,
      ],
      [
        'a $PWD after a cd, read as the directory the command runs in',
        () => 'cd .claude && echo x > "$PWD/hooks/novo.mjs"',
        harness,
      ],
      [
        'a $PWD the line may have set',
        () => 'read -r PWD < /tmp/x; echo x > "$PWD/README.md"',
        /não consegui ler onde o comando escreve/,
      ],
    ])('asks, critical, for %s', async (_, line, reason) => {
      await asksCritical(line(), reason)
    })

    it.each([
      // Copilot's own example: README.md is an ordinary file of the
      // project, and a shell write to one passes, through a link or not
      // (the documented limit of ADR 0002).
      [
        'Copilot’s example, a link to README.md',
        () => 'ln -s "$PWD/README.md" /tmp/link && echo x > /tmp/link',
      ],
      ['a link to README.md on disk', () => `echo x > ${at('readme')}`],
      [
        'a hard link to README.md',
        () => `ln README.md ${at('h-readme')} && echo x > ${at('h-readme')}`,
      ],
      ['a link to an unrelated file', () => `echo x > ${at('unrelated')}`],
      [
        'a link to an unrelated file made on the line',
        () =>
          `ln -s ${at('alvo.txt')} ${at('novo-alvo')} && echo x > ${at('novo-alvo')}`,
      ],
      [
        'a relative link that names the hatch from its own directory',
        () =>
          `ln -s .claude/settings.local.json ${at('novo-fora')} && echo x > ${at('novo-fora')}`,
      ],
      [
        'a link over an existing entry, which ln refuses without -f',
        () =>
          `ln -s "$PWD/.claude/settings.local.json" ${at('unrelated')} ; echo x > ${at('unrelated')}`,
      ],
      [
        'a link to the hatch that nothing writes through',
        () =>
          `ln -s "$PWD/.claude/settings.local.json" ${at('so-link')} && cat ${at('so-link')}`,
      ],
      ['a write to /tmp', () => 'echo x > /tmp/guard-bash-links.txt'],
      ['a write to $PWD/README.md', () => 'echo x > "$PWD/README.md"'],
    ])('passes %s', async (_, line) => {
      await passes(line())
    })

    it('keeps what a copy takes from a file the line wrote, under a path with a link in it', async () => {
      // Where /tmp is a link (on macOS, to /private/tmp), the copy reads the
      // same file the line wrote, however the two spell it. The other
      // spelling is taken from this machine: on Linux /tmp is no link, and
      // a /private/tmp path would name another, unread file.
      const realTmp = realpathSync.native('/tmp')
      if (realTmp !== '/tmp')
        await denies(
          `printf '# Owner Approve\\n' > /tmp/guard-bash-corpo.md && cp ${realTmp}/guard-bash-corpo.md body-copia.md && gh issue comment 5 -F body-copia.md`,
          opening,
        )
      await denies(
        "printf '# Owner Approve\\n' > /tmp/guard-bash-corpo.md && cp /tmp/guard-bash-corpo.md body-copia.md && gh issue comment 5 -F body-copia.md",
        opening,
      )
    })

    it('reads a body written through a link as the file the link reaches', async () => {
      await denies(
        `ln -s "$PWD/body.md" ${at('corpo')} && printf '# Owner Approve\\n' > ${at('corpo')} && gh issue comment 5 -F body.md`,
        opening,
      )
      await denies(
        `printf '# Owner Approve\\n' > body.md && gh issue comment 5 -F ${at('body-link')}`,
        opening,
      )
    })

    // What the verification of the eighth round found untested, or open.
    const body = /não consegui ler o corpo do comentário/

    it.each([
      [
        'a `..` taken from the directory a link reaches, as the kernel does',
        () => `echo x > ${at('claude')}/../.claude/settings.local.json`,
        hatch,
      ],
      [
        'a link ln -T puts in place of a link to a directory',
        () =>
          `ln -sfT "$PWD/.claude/settings.local.json" ${at('pasta-link')} && echo x > ${at('pasta-link')}`,
        hatch,
      ],
      [
        'a link ln -n puts in place of a link to a directory',
        () =>
          `ln -sfn "$PWD/.claude/settings.local.json" ${at('pasta-link')} && echo x > ${at('pasta-link')}`,
        hatch,
      ],
      [
        'a link ln -h puts in place of a link to a directory',
        () =>
          `ln -sfh "$PWD/.claude/settings.local.json" ${at('pasta-link')} && echo x > ${at('pasta-link')}`,
        hatch,
      ],
      [
        'rsync --link-dest relative to the destination',
        () => 'rsync -a --link-dest=../.claude /tmp/x/ sub/',
        /contém .claude\/settings.local.json/,
      ],
      [
        'a link the line made, copied as a link by rsync',
        () =>
          `ln -s "$PWD/.claude/settings.local.json" ${at('r1')} && rsync -a ${at('r1')} ${at('r2')} && echo x > ${at('r2')}`,
        hatch,
      ],
      [
        'a link the line made, copied as a link by ditto',
        () =>
          `ln -s "$PWD/.claude/settings.local.json" ${at('t1')} && ditto ${at('t1')} ${at('t2')} && echo x > ${at('t2')}`,
        hatch,
      ],
      // Listed after the line's own commands, a `bash -c` script or a
      // substitution runs before the command that holds it.
      [
        'a write through a link a `bash -c` script makes',
        () =>
          `bash -c 'ln -s "$PWD/.claude/settings.local.json" ${at('b1')}' && echo x > ${at('b1')}`,
        hatch,
      ],
      [
        'a write through a link a substitution makes',
        () =>
          `echo "$(ln -s "$PWD/.git/${gateCacheFile}" ${at('b2')})" ; echo x > ${at('b2')}`,
        loopFile,
      ],
      [
        'a write through a link a substitution replaces',
        () =>
          `link ${at('alvo.txt')} ${at('s1')} && echo "$(ln -sf "$PWD/.claude/settings.local.json" ${at('s1')})" && echo x > ${at('s1')}`,
        hatch,
      ],
      [
        'a write through a link a `bash -c` script copies',
        () =>
          `bash -c 'ln -s "$PWD/.claude/settings.local.json" ${at('k1')} && cp -P ${at('k1')} ${at('k2')}' && echo x > ${at('k2')}`,
        hatch,
      ],
      [
        'a write through links of the line and of a substitution listed after them, in the order that reaches the hatch',
        () =>
          `true $(ln -sfn /tmp ${at('x1')}; ln -s "$PWD/.claude/settings.local.json" ${at('pasta')}/y) && ln -sfn ${at('pasta')} ${at('x1')} && echo x > ${at('x1')}/y`,
        hatch,
      ],
      [
        'rm of a link named as a plan marker',
        () => `rm .claude/${planPendingFile('sessao-2')}`,
        loopFile,
      ],
      // Bodies: what the line leaves where a link lands.
      [
        'a body written through a hard link the line made',
        () =>
          `ln body.md ${at('hb')} && printf '# Owner Approve\\n' > ${at('hb')} && gh issue comment 5 -F body.md`,
        opening,
      ],
      [
        'a body written through a link mv carried',
        () =>
          `ln -s "$PWD/body.md" ${at('mv1')} && mv ${at('mv1')} ${at('mv2')} && printf '# Owner Approve\\n' > ${at('mv2')} && gh issue comment 5 -F body.md`,
        opening,
      ],
      [
        'a body cat reads through a link the line made',
        () =>
          `ln -s "$PWD/body.md" ${at('lc')} && printf '# Owner Approve\\n' > body.md && cat ${at('lc')} > copia-cat.md && gh issue comment 5 -F copia-cat.md`,
        opening,
      ],
      [
        'a body read through a link the line put over one on disk',
        () =>
          `ln -sf ${at('aprova.md')} ${at('unrelated')} && gh issue comment 5 -F ${at('unrelated')}`,
        opening,
      ],
    ])('denies %s', async (_, line, reason) => {
      await denies(line(), reason)
    })

    it.each([
      // The entry itself: sed -i and rm replace or remove the link, not
      // what it leads to.
      [
        'sed -i of a link in .claude',
        () => "sed -i '' 's/a/b/' .claude/fora",
        harness,
      ],
      ['rm of a link in .claude', () => 'rm .claude/fora', harness],
      [
        'rm of a link in .claude, reached through a link to the directory',
        () => `rm ${at('claude')}/fora`,
        harness,
      ],
      ['rm of a link in the git dir', () => 'rm .git/pasta-link', inGitDir],
      [
        'a $PWD a script the line runs may have set',
        () => `cd ${links} && bash muda-pwd.sh`,
        /não consegui ler onde o comando escreve/,
      ],
      [
        'a $PWD a quoted name may have set',
        () =>
          `cd ${links} && read -r P''WD < /tmp/x; echo x > "$PWD/.claude/settings.json"`,
        /não consegui ler onde o comando escreve/,
      ],
      // Where the write lands is not certain: the files it may land in are
      // not known after it.
      [
        'a body the disk’s link may have taken, under a link the line made',
        () =>
          `ln -sfn ${linked.dir} ${at('pasta-link')} ; printf '# Owner Approve\\n' > ${at('pasta-link')}/f.md ; gh issue comment 5 -F ${at('pasta')}/f.md`,
        body,
      ],
      [
        'a body the line wrote under two spellings that differ in case',
        () =>
          `printf 'Recado.\\n' > ${at('Caso.md')} && printf '# Owner Approve\\n' > ${at('CASO.md')} && gh issue comment 5 -F ${at('Caso.md')}`,
        body,
      ],
      [
        'a body a link of a `bash -c` script may have taken',
        () =>
          `bash -c 'ln -s "$PWD/body.md" ${at('b3')}' && printf '# Owner Approve\\n' > ${at('b3')} && gh issue comment 5 -F body.md`,
        body,
      ],
      [
        'a body read through a link a substitution listed later makes',
        () =>
          `echo "$(ln -sf ${at('aprova.md')} ${at('unrelated')})" && gh issue comment 5 -F ${at('unrelated')}`,
        body,
      ],
      [
        'a body cat reads through a link a substitution listed later makes',
        () =>
          `printf 'Recado.\\n' > ${at('unrelated')} && echo "$(ln -sf ${at('aprova.md')} ${at('unrelated')})" && cat ${at('unrelated')} > copia-cat2.md && gh issue comment 5 -F copia-cat2.md`,
        body,
      ],
      [
        'a body cp copies through a directory a substitution listed later links',
        () =>
          `printf 'Recado.\\n' > ${at('pasta-link')}/f.md && echo "$(ln -sfn ${at('aprova-dir')} ${at('pasta-link')})" && cp ${at('pasta-link')}/f.md copia-cp2.md && gh issue comment 5 -F copia-cp2.md`,
        body,
      ],
      [
        'a body cp copies from a link a substitution listed later replaces',
        () =>
          `cp ${at('aprova-link')} copia-cp3.md && gh issue comment 5 -F copia-cp3.md && echo "$(ln -sf ${at('alvo.txt')} ${at('aprova-link')})"`,
        body,
      ],
      [
        'a body cp copies through a link a substitution listed later makes',
        () =>
          `printf 'Recado.\\n' > ${at('unrelated')} && echo "$(ln -sf ${at('aprova.md')} ${at('unrelated')})" && cp ${at('unrelated')} copia-cp.md && gh issue comment 5 -F copia-cp.md`,
        body,
      ],
    ])('asks, critical, for %s', async (_, line, reason) => {
      await asksCritical(line(), reason)
    })

    it('names a file that is no link as the file, not as the link itself', async () => {
      const line = 'cp /tmp/x .claude/hooks/novo.mjs'
      await asksCritical(line, harness)
      expect(reasonOf(await run(line))).not.toMatch(/em si/)
    })

    it('asks, not denies, for a body on disk after a write through a link it cannot read', async () => {
      // aprova.md opens as the Approve on disk, but the write may have
      // rewritten it: uncertain, so a critical ask.
      const line = `ln -s "$ALVO" ${at('u3')} ; printf 'x\\n' > ${at('u3')} ; gh issue comment 5 -F ${at('aprova.md')}`
      await asksCritical(line, body)
      expect(reasonOf(await run(line))).not.toMatch(opening)
    })

    it.each([
      [
        'a second link over one the line made, which ln refuses without -f',
        () =>
          `ln -s ${at('alvo.txt')} ${at('e1')} && ln -s "$PWD/.claude/settings.local.json" ${at('e1')} ; echo x > ${at('e1')}`,
      ],
    ])('passes %s', async (_, line) => {
      await passes(line())
    })

    it('reads the repository around a directory once, however a write spells it', async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'guard-bash-git-calls-'))
      try {
        const log = path.join(root, 'git.log')
        const bin = gitShim(root, `printf '%s\\n' "$*" >> '${log}'`)
        const env = linked.env({
          PATH: [bin, linked.bin, process.env.PATH ?? ''].join(path.delimiter),
        })
        // ${links}/claude is <repo>/.claude: one directory, two spellings.
        expectAsk(
          await guard(`echo x > ${at('claude')}/nota.txt`, {
            repo: linked,
            env,
          }),
          harness,
        )
        const reads = readFileSync(log, 'utf8')
          .split('\n')
          .filter((call) => call.includes('--show-toplevel'))
        expect(reads).toHaveLength(1)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  },
)

// ---------------------------------------------------------------------------
// Ninth round of Copilot's review of #26

describe.concurrent(
  'the account a gh command runs as (Copilot review of #26, ninth round)',
  () => {
    const modes = ['default', 'auto'] as const
    const accountVariables = [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GH_ENTERPRISE_TOKEN',
      'GITHUB_ENTERPRISE_TOKEN',
      'GH_CONFIG_DIR',
    ] as const
    type AccountVariable = (typeof accountVariables)[number]

    /** What the hook inherits for each variable: the account its live reads use. */
    const hookValue = (name: AccountVariable) =>
      name === 'GH_CONFIG_DIR'
        ? path.join(feature.root, 'gh-do-hook')
        : `valor-do-hook-${name}`

    const merge = 'gh pr merge 7'
    const transition =
      'gh issue edit 5 --remove-label needs-triage --add-label ready-for-human'
    const resolve = `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_1"}) { thread { isResolved } } }'`
    /**
     * What each check would read: a merge that is not ready (a deny), and a
     * transition and a thread in order (a pass). Read with the hook's
     * account, each would be judged by the wrong one.
     */
    const fixtures: Record<string, unknown> = {
      [merge]: {
        prs: { 7: { pr: readyPr({ threads: [{ isResolved: false }] }) } },
      },
      [transition]: {
        issues: {
          5: {
            labels: ['enhancement', 'needs-triage'],
            lastCommentBody: '# Plano\n\n## Contexto e porquê\n\nTexto.',
          },
        },
      },
      [resolve]: {
        viewer: { login: 'geazioliveira' },
        threads: { PRRT_1: { lastAuthor: 'geazioliveira' } },
      },
    }
    const other = /o comando pode rodar o gh com outra conta que a do hook/
    const switched =
      /a linha tem um gh auth login, logout, switch ou refresh, ou um gh config set/

    /**
     * `env -i` with what it takes out of the clean environment put back as
     * the hook has it (HOME, XDG_CONFIG_HOME and the git config), so that
     * only the account variables change: the git config gh reads would
     * otherwise leave the target unknown (seventh round) before any read.
     */
    const envI = (env: NodeJS.ProcessEnv) =>
      `env -i ${[
        'HOME',
        'XDG_CONFIG_HOME',
        'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_NOSYSTEM',
      ]
        .map((name) => `${name}='${env[name]}'`)
        .join(' ')}`

    /**
     * The ways a line changes a variable for the command: on it, exported or
     * assigned before it, taken out by env -u, or by env -i (envI). `env` is
     * the hook's environment.
     */
    const forms: [
      string,
      (name: AccountVariable, line: string, env: NodeJS.ProcessEnv) => string,
    ][] = [
      ['on the command', (name, line) => `${name}=outro ${line}`],
      ['exported before it', (name, line) => `export ${name}=outro; ${line}`],
      ['assigned before it', (name, line) => `${name}=outro; ${line}`],
      ['taken out by env -u', (name, line) => `env -u ${name} ${line}`],
      ['taken out by env -i', (_, line, env) => `${envI(env)} ${line}`],
    ]

    /** A critical ask that read nothing: an ask, a deny in auto. */
    function expectUnread(
      run: HookRun,
      mode: string,
      calls: () => GhCall[],
      reason: RegExp,
    ) {
      if (mode === 'auto')
        expectDeny(run, /Em auto, a confirmação vira negação/)
      else expectAsk(run)
      expect(reasonOf(run)).toMatch(reason)
      expect(calls()).toEqual([])
    }

    test.for(
      modes.flatMap((mode) =>
        accountVariables.flatMap((name) =>
          forms.map(([form, line]) => [mode, name, form, line] as const),
        ),
      ),
    )(
      'gh pr merge with %s … %s %s reads nothing and asks, critical',
      async ([mode, name, , line], { live }) => {
        const gh = live(fixtures[merge], { [name]: hookValue(name) })
        const run = await guard(line(name, merge, gh.env), {
          env: gh.env,
          mode,
        })
        expectUnread(run, mode, gh.calls, other)
        expect(reasonOf(run)).toContain(name)
      },
    )

    test.for(
      modes.flatMap((mode) =>
        [transition, resolve].flatMap((check) =>
          accountVariables.map((name) => [mode, check, name] as const),
        ),
      ),
    )(
      'in %s, %s with its own %s reads nothing and asks, critical',
      async ([mode, check, name], { live }) => {
        const gh = live(fixtures[check], { [name]: hookValue(name) })
        expectUnread(
          await guard(`${name}=outro ${check}`, { env: gh.env, mode }),
          mode,
          gh.calls,
          other,
        )
      },
    )

    test.for(
      modes.flatMap((mode) =>
        [
          `gh auth switch --user outra && ${merge}`,
          `gh auth login --with-token < /dev/null; ${merge}`,
          `gh auth logout --hostname github.com --user outra; ${merge}`,
          `gh auth refresh --hostname github.com -s repo && ${merge}`,
          `gh config set -h github.com git_protocol ssh && ${merge}`,
          // A substitution runs before the command that holds it.
          `${merge} --subject "$(gh auth switch --user outra)"`,
          // An alias the line defines, run before the merge.
          `gh alias set sw 'auth switch' && gh sw --user outra && ${merge}`,
          `gh auth switch --user outra && ${transition}`,
          `gh auth switch --user outra && ${resolve}`,
        ].map((line) => [mode, line] as const),
      ),
    )(
      'in %s, `%s` reads nothing and asks, critical',
      async ([mode, line], { live }) => {
        const check = line.endsWith(transition)
          ? transition
          : line.endsWith(resolve)
            ? resolve
            : merge
        const gh = live(fixtures[check])
        const run = await guard(line, { env: gh.env, mode })
        if (mode === 'auto') expectDeny(run)
        else expectAsk(run)
        expect(reasonOf(run)).toMatch(switched)
        expect(gh.calls()).toEqual([])
      },
    )

    /**
     * Lines whose gh runs with the hook's own account: read live, as today,
     * with the environment the hook inherited. `inherited` is what the hook
     * inherits besides the clean environment.
     */
    const controls: [
      string,
      (env: NodeJS.ProcessEnv) => string,
      Partial<Record<AccountVariable, true>>,
    ][] = [
      ['no override', () => merge, { GH_TOKEN: true, GH_CONFIG_DIR: true }],
      [
        'GH_TOKEN equal to the inherited one',
        () => `GH_TOKEN=${hookValue('GH_TOKEN')} ${merge}`,
        { GH_TOKEN: true },
      ],
      [
        'GH_CONFIG_DIR exported equal to the inherited one',
        () => `export GH_CONFIG_DIR='${hookValue('GH_CONFIG_DIR')}'; ${merge}`,
        { GH_CONFIG_DIR: true },
      ],
      [
        'env -u of a variable the hook does not inherit',
        () => `env -u GH_TOKEN -u GITHUB_TOKEN ${merge}`,
        {},
      ],
      [
        'env -i with no account variable inherited',
        (env) => `${envI(env)} ${merge}`,
        {},
      ],
      // gh's config dir is XDG_CONFIG_HOME/gh while it is set: HOME alone
      // does not move it.
      ['HOME under XDG_CONFIG_HOME', () => `HOME=/outra ${merge}`, {}],
      [
        'gh auth status and gh auth token before it',
        () => `gh auth status && gh auth token >/dev/null && ${merge}`,
        { GH_TOKEN: true },
      ],
    ]

    test.for(
      modes.flatMap((mode) =>
        controls.map(
          ([name, line, inherited]) => [mode, name, line, inherited] as const,
        ),
      ),
    )(
      'in %s, %s: read live with the hook’s own account, as today',
      async ([mode, , line, inherited], { live }) => {
        const extra = Object.fromEntries(
          Object.keys(inherited).map((name) => [
            name,
            hookValue(name as AccountVariable),
          ]),
        )
        const gh = live(fixtures[merge], extra)
        expectDeny(
          await guard(line(gh.env), { env: gh.env, mode }),
          /1 thread\(s\) de revisão aberta\(s\)/,
        )
        const calls = gh.calls()
        expect(calls).toEqual([
          expect.objectContaining({ call: 'prByNumber', key: '7' }),
        ])
        // The read authenticated with what the hook inherits, nothing else.
        for (const name of accountVariables)
          expect(calls[0].auth?.[name]).toBe(extra[name] ?? null)
        expect(calls[0].auth?.HOME).toBe(gh.env.HOME)
        expect(calls[0].auth?.XDG_CONFIG_HOME).toBe(gh.env.XDG_CONFIG_HOME)
      },
    )

    // A relative GH_CONFIG_DIR is gh's from the directory it runs in. From
    // one the hook cannot read (`cd "$X"`), it may be any, even when its
    // text leads, from the input's cwd, to the hook's own; the merge names
    // its repository (-R), so its target is still read.
    const byName = `${merge} -R geazioliveira/marketo-sandbox`
    const relative: [string, () => string, boolean][] = [
      [
        'relative, after a cd the hook cannot read',
        () => `cd "$X" && GH_CONFIG_DIR=../../gh-do-hook ${byName}`,
        true,
      ],
      [
        'relative, in the input’s cwd, the hook’s own dir',
        () => `GH_CONFIG_DIR=../gh-do-hook ${merge}`,
        false,
      ],
      [
        'absolute, the hook’s own dir, after a cd the hook cannot read',
        () =>
          `cd "$X" && GH_CONFIG_DIR='${hookValue('GH_CONFIG_DIR')}' ${byName}`,
        false,
      ],
    ]

    test.for(
      modes.flatMap((mode) =>
        relative.map(
          ([name, line, changed]) => [mode, name, line, changed] as const,
        ),
      ),
    )('in %s, GH_CONFIG_DIR %s', async ([mode, , line, changed], { live }) => {
      const inherited = hookValue('GH_CONFIG_DIR')
      const gh = live(fixtures[merge], { GH_CONFIG_DIR: inherited })
      const run = await guard(line(), { env: gh.env, mode })
      if (changed) {
        expectUnread(run, mode, gh.calls, other)
        expect(reasonOf(run)).toContain('GH_CONFIG_DIR')
        return
      }
      expectDeny(run, /1 thread\(s\) de revisão aberta\(s\)/)
      const calls = gh.calls()
      expect(calls).toEqual([
        expect.objectContaining({ call: 'prByNumber', key: '7' }),
      ])
      expect(calls[0].auth?.GH_CONFIG_DIR).toBe(inherited)
    })
  },
)
