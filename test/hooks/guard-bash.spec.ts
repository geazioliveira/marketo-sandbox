import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base } from 'vitest'
import {
  copilotReviewer,
  requiredChecks,
} from '../../scripts/loop-sections.mjs'
import {
  type HookRepo,
  hookRepo,
  type HookRun,
  runHook,
  setupTimeout,
  processTimeout,
} from '../support/hooks'

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
  ;[feature, onMain, elsewhere] = await Promise.all([
    hookRepo({ branch: FEATURE }),
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
  call?: string
  key?: string
  mode?: string
  violation?: string
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

  test('asks, not critical, when gh fails', async ({ live }) => {
    const gh = live(issue({ mode: 'fail' }))
    const run = await guard(transition, { env: gh.env, mode: 'auto' })
    expectAsk(
      run,
      /não consegui confirmar que a issue está em needs-triage com um # Plano como último comentário \(HTTP 502/,
    )
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
      'git commit -m x && git checkout main && git pull',
      'git stash && git checkout main && git stash pop',
      'git checkout README.md && git commit -m x',
    ])('passes %s', async (text) => {
      expectPass(await guard(text))
    })

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
    ])('asks, not critical, for %s', async (_, text, reason) => {
      const run = await guard(text, { mode: 'auto' })
      expectAsk(run, reason)
    })

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
      const run = await guard(
        "python3 - <<'EOF'\nopen('b-recado.md', 'w').write('# Owner Approve\\n')\nEOF\ngh issue comment 5 --body-file b-recado.md",
        { mode: 'auto' },
      )
      expectAsk(run, /não consegui ler o corpo do comentário/)
      expect(reasonOf(run)).not.toMatch(/indireção/)
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
