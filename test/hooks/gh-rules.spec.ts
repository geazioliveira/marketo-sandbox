import {
  chmodSync,
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
  skipCiTokens,
  skipChecksTrailer,
  stateLabels,
} from '../../scripts/loop-sections.mjs'
import { cleanEnv } from '../support/clean-env'
import {
  type Decision,
  fakeGhHooks,
  type IoLib,
  loadHookLib,
  PROJECT,
  type RepoInfo,
  type ShellLib,
  setupTimeout,
  processTimeout,
} from '../support/hooks'

/**
 * The rules for `gh` (.claude/hooks/lib/gh-rules.mjs). The rules are judged
 * in process, with a stub for the live reads that records every question it
 * is asked, so each case says both the verdict and whether GitHub was read.
 * githubClient, the live reads themselves, runs against the strict fake gh
 * (test/support/fake-gh-hooks.mjs) as a real process, so the argv it sends
 * and the GraphQL shape it parses are the ones the fake mirrors.
 */

interface Read<T> {
  ok: boolean
  value?: T
  reason?: string
}

interface IssueState {
  labels: string[]
  labelsComplete: boolean
  lastCommentBody: string | null
}

interface MergeState {
  number: number
  state: string | null
  headRefOid: string
  checksOk: boolean
  checksDetail: string
  review: { ok: boolean; failed: boolean }
  requested: boolean
  openThreads: unknown[]
  pagesComplete: boolean
  unread: string[]
}

interface Github {
  viewer(): Read<string>
  issueState(repo: string, number: number): Read<IssueState>
  threadLastAuthor(threadId: string): Read<string | null>
  prMergeState(repo: string, prRef: number | string): Read<MergeState>
}

interface GhRulesLib {
  githubCalls: Record<string, { variables: string[]; query: string }>
  githubCallArgv(
    name: string,
    values?: Record<string, unknown>,
    host?: string,
  ): string[]
  githubClient(options?: {
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    host?: string
  }): Github
  githubClients(options?: {
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
  }): (host: string) => Github
  ghDecision(command: unknown, ctx: GhCtx): Promise<Decision>
  ghAliasDefinitions(
    command: unknown,
    ctx: Partial<GhCtx>,
  ): [string, { known: boolean; text: string | null } | null][]
  ghMovesHead(command: unknown, ctx: Partial<GhCtx>): boolean
  tripwireMutations: string[]
}

/** The repository as guard-bash hands it on: branchKnown false when an earlier command moved HEAD. */
type SeenRepo = RepoInfo & {
  branchKnown?: boolean
  repoKnown?: boolean
  remoteKnown?: boolean
}

interface GhCtx {
  cwd: string
  repo: SeenRepo | null
  permissionMode?: string
  github?: Github
  /** The client for the host a command's reads go to (fifth round). */
  githubFor?: (host: string) => Github
  cwdKnown?: boolean
  env?: Record<string, string | undefined>
  files?: (file: string) => { known: boolean; text: string | null } | undefined
  ghAliases?: Map<string, { known: boolean; text: string | null } | null>
  judgeOther?: (command: unknown, ctx: GhCtx) => Promise<Decision>
}

let gh: GhRulesLib
let shell: ShellLib
let io: IoLib

beforeAll(async () => {
  ;[gh, shell, io] = await Promise.all([
    loadHookLib<GhRulesLib>('gh-rules'),
    loadHookLib<ShellLib>('shell'),
    loadHookLib<IoLib>('io'),
  ])
}, setupTimeout)

vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })

const HEAD = 'a'.repeat(40)
const BRANCH = 'feature/5-hooks-claude-code'

const project = (branch: string | null = BRANCH): RepoInfo => ({
  top: '/tmp/projeto',
  gitDir: '/tmp/projeto/.git',
  commonDir: '/tmp/projeto/.git',
  branch,
  repo: PROJECT,
})

// ---------------------------------------------------------------------------
// The stub for the live reads

type Call = [string, ...unknown[]]

interface Stub extends Github {
  calls: Call[]
}

const failure = (reason = 'HTTP 502: Bad Gateway'): Read<never> => ({
  ok: false,
  reason,
})

function stub(answers: Partial<Record<keyof Github, unknown>> = {}): Stub {
  const calls: Call[] = []
  const answer =
    (name: keyof Github) =>
    (...args: unknown[]) => {
      calls.push([name, ...args])
      const value = answers[name]
      if (value === undefined)
        throw new Error(`leitura inesperada: ${name}(${JSON.stringify(args)})`)
      return value
    }
  return {
    calls,
    viewer: answer('viewer') as Github['viewer'],
    issueState: answer('issueState') as Github['issueState'],
    threadLastAuthor: answer('threadLastAuthor') as Github['threadLastAuthor'],
    prMergeState: answer('prMergeState') as Github['prMergeState'],
  }
}

const issueAnswer = (state: Partial<IssueState> = {}): Read<IssueState> => ({
  ok: true,
  value: {
    labels: ['enhancement', 'needs-triage'],
    labelsComplete: true,
    lastCommentBody: '# Plano\n\n## Contexto e porquê\n\nTexto.',
    ...state,
  },
})

const mergeAnswer = (state: Partial<MergeState> = {}): Read<MergeState> => ({
  ok: true,
  value: {
    number: 7,
    state: 'OPEN',
    headRefOid: HEAD,
    checksOk: true,
    checksDetail: 'Vínculo com issue / issue-link e Qualidade / check verdes',
    review: { ok: true, failed: false },
    requested: false,
    openThreads: [],
    pagesComplete: true,
    unread: [],
    ...state,
  },
})

// ---------------------------------------------------------------------------
// Judging a command line

interface JudgeOptions {
  repo?: SeenRepo | null
  github?: Stub
  cwd?: string
  /** The rest of what guard-bash hands a rule (review of #5). */
  extra?: Partial<GhCtx>
}

const test = base.extend<{ scratch: () => string }>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  scratch: async ({}, use) => {
    const dirs: string[] = []
    await use(() => {
      const dir = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'gh-rules-')),
      )
      dirs.push(dir)
      return dir
    })
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  },
})

/** Every gh command of the line through ghDecision, combined as guard-bash does. */
async function judge(
  text: string,
  {
    repo = project(),
    github = stub(),
    cwd = tmpdir(),
    extra = {},
  }: JudgeOptions = {},
): Promise<Decision> {
  const parsed = shell.parseCommand(text)
  const decisions: Decision[] = []
  for (const command of parsed.commands)
    if (command.argv[0] === 'gh')
      decisions.push(
        await gh.ghDecision(command, {
          cwd: path.resolve(cwd, command.cwd ?? '.'),
          repo,
          permissionMode: 'default',
          github,
          ...extra,
        }),
      )
  return io.combine(decisions)
}

const expectPass = (decision: Decision) =>
  expect(decision).toEqual({ decision: 'pass' })

function expectDeny(decision: Decision, reason?: RegExp | string) {
  expect(decision.decision).toBe('deny')
  if (reason !== undefined) expect(decision.reason).toMatch(reason)
}

function expectAsk(
  decision: Decision,
  {
    critical = false,
    reason,
  }: { critical?: boolean; reason?: RegExp | string } = {},
) {
  expect(decision.decision).toBe('ask')
  expect(decision.critical === true).toBe(critical)
  if (reason !== undefined) expect(decision.reason).toMatch(reason)
}

const opening =
  /não abre como Approve, retirada nem título que mencione approve/
const unreadBody =
  /não consegui ler o corpo do comentário para conferir a primeira linha/

// ---------------------------------------------------------------------------

describe('comment openings (gh issue comment)', () => {
  it.each([
    ['the Approve', '# Owner Approve\n\nPode seguir.'],
    ['a withdrawal', '# Approve retirado'],
    ['a near miss in another level', '## Owner Approve'],
    ['a near miss in bold', '**Approve**'],
    ['a near miss behind a quote', '> # Approve retirado'],
    ['a setext heading', 'Approve\n==='],
    ['blank lines before the Approve', '\n\n# Owner Approve\nsim'],
  ])('denies a body that opens as %s', async (_, body) => {
    expectDeny(await judge(`gh issue comment 5 --body "${body}"`), opening)
  })

  it.each([
    ['prose', 'Rodei o gate e passou.'],
    ['a plan', '# Plano\n\n## Contexto e porquê\n\nTexto.'],
    [
      'prose that mentions the Approve',
      'Aguardando o # Owner Approve do dono.',
    ],
    ['an issue reference', '#5 aguarda o Approve'],
  ])('passes a body that opens with %s', async (_, body) => {
    expectPass(await judge(`gh issue comment 5 -b "${body}"`))
  })

  test('reads --body-file relative to the command directory', async ({
    scratch,
  }) => {
    const dir = scratch()
    mkdirSync(path.join(dir, 'sub'))
    writeFileSync(path.join(dir, 'sub', 'a.md'), '# Owner Approve\nsim\n')
    writeFileSync(path.join(dir, 'sub', 'b.md'), 'Só um recado.\n')
    expectDeny(
      await judge('cd sub && gh issue comment 5 --body-file a.md', {
        cwd: dir,
      }),
      opening,
    )
    expectPass(
      await judge('cd sub && gh issue comment 5 -F b.md', { cwd: dir }),
    )
  })

  it('reads -F - from a heredoc', async () => {
    const text = "gh issue comment 5 -F - <<'EOF'\n# Approve retirado\nEOF"
    expectDeny(await judge(text), opening)
  })

  it('checks every --body, not only the one gh keeps', async () => {
    expectDeny(
      await judge(`gh issue comment 5 -b "# Owner Approve" -b "recado"`),
      opening,
    )
  })

  it.each([
    ['an expansion', 'gh issue comment 5 --body "$BODY"'],
    ['a substitution', 'gh issue comment 5 --body "$(cat corpo.md)"'],
    ['a missing file', 'gh issue comment 5 --body-file /nao/existe.md'],
    ['a pipe on stdin', 'cat corpo.md | gh issue comment 5 -F -'],
    ['the editor', 'gh issue comment 5 --editor'],
    ['the browser', 'gh issue comment 5 --web'],
  ])(
    'asks, critical, when the body is %s (Copilot review of #26, third round)',
    async (_, text) => {
      expectAsk(await judge(text), { critical: true, reason: unreadBody })
    },
  )

  it('asks for --edit-last even with an ordinary body', async () => {
    expectAsk(await judge('gh issue comment 5 --edit-last -b "Corrigido."'), {
      reason: 'editar um comentário depois do Approve o revoga',
    })
  })

  it('denies --edit-last into an Approve', async () => {
    expectDeny(
      await judge('gh issue comment 5 --edit-last -b "# Owner Approve"'),
      opening,
    )
  })

  it('asks for --delete-last', async () => {
    expectAsk(await judge('gh issue comment 5 --delete-last --yes'), {
      reason: 'apagar um comentário depois do Approve o revoga',
    })
  })
})

describe('gh issue create', () => {
  it('denies ready-for-agent', async () => {
    expectDeny(
      await judge('gh issue create -t T -b corpo --label ready-for-agent'),
      /ready-for-agent é do dono/,
    )
  })

  it('denies a state label outside the ones the agent may set', async () => {
    expectDeny(
      await judge('gh issue create -t T -b corpo -l enhancement -l needs-info'),
      /nasce com ready-for-human ou needs-triage, não com needs-info/,
    )
  })

  it('denies two state labels, comma-separated or repeated', async () => {
    expectDeny(
      await judge('gh issue create -t T -b c -l ready-for-human,needs-triage'),
      /uma só label de estado/,
    )
    expectDeny(
      await judge(
        'gh issue create -t T -b c -l needs-triage --label ready-for-human',
      ),
      /uma só label de estado/,
    )
  })

  it('passes a category and one state label the agent may set', async () => {
    expectPass(
      await judge(
        'gh issue create -t T -b corpo --label enhancement --label ready-for-human',
      ),
    )
    expectPass(await judge('gh issue new -t T -b corpo -l bug,needs-triage'))
  })

  it('compares labels without case', async () => {
    expectDeny(
      await judge('gh issue create -t T -b c -l READY-FOR-AGENT'),
      /ready-for-agent é do dono/,
    )
  })

  it('asks, critical, when a label cannot be read', async () => {
    expectAsk(await judge('gh issue create -t T -b c -l "$LABEL"'), {
      critical: true,
      reason: /não consegui ler as labels/,
    })
  })

  it('runs the opening check on the body', async () => {
    expectDeny(
      await judge('gh issue create -t T -b "# Owner Approve" -l bug'),
      opening,
    )
  })

  it('asks, critical, for --recover', async () => {
    expectAsk(await judge('gh issue create --recover rascunho.json'), {
      critical: true,
      reason: /--recover/,
    })
  })
})

describe('gh issue edit: the label rule and its one exception', () => {
  const transition =
    'gh issue edit 5 --remove-label needs-triage --add-label ready-for-human'

  it('passes the transition when the issue is in needs-triage and its last comment is a # Plano', async () => {
    const github = stub({ issueState: issueAnswer() })
    expectPass(await judge(transition, { github }))
    expect(github.calls).toEqual([['issueState', PROJECT, 5]])
  })

  it('reads the issue a project URL names', async () => {
    const github = stub({ issueState: issueAnswer() })
    expectPass(
      await judge(
        `gh issue edit https://github.com/${PROJECT}/issues/5 --add-label ready-for-human --remove-label needs-triage`,
        { github },
      ),
    )
    expect(github.calls).toEqual([['issueState', PROJECT, 5]])
  })

  it('denies ready-for-agent added in place of ready-for-human, without reading', async () => {
    const github = stub()
    expectDeny(
      await judge(
        'gh issue edit 5 --remove-label needs-triage --add-label ready-for-agent',
        { github },
      ),
      /o Approve e ready-for-agent são do dono/,
    )
    expect(github.calls).toEqual([])
  })

  it('denies ready-for-agent added alongside the transition', async () => {
    expectDeny(
      await judge(`${transition} --add-label ready-for-agent`),
      /só troca needs-triage por ready-for-human/,
    )
  })

  it.each([
    [
      'in the same flag',
      'gh issue edit 5 --remove-label needs-triage --add-label ready-for-human,enhancement',
    ],
    ['in another flag', `${transition} --add-label bug`],
    ['as a removal', `${transition} --remove-label bug`],
    ['that cannot be read', `${transition} --add-label "$X"`],
  ])('denies an extra label %s, without reading', async (_, text) => {
    const github = stub()
    expectDeny(
      await judge(text, { github }),
      /só troca needs-triage por ready-for-human/,
    )
    expect(github.calls).toEqual([])
  })

  it('denies the transition on two issues', async () => {
    const github = stub()
    expectDeny(
      await judge(
        'gh issue edit 5 6 --remove-label needs-triage --add-label ready-for-human',
        { github },
      ),
      /só troca needs-triage por ready-for-human/,
    )
    expect(github.calls).toEqual([])
  })

  it.each([
    [
      'only adds ready-for-human',
      'gh issue edit 5 --add-label ready-for-human',
    ],
    [
      'only removes needs-triage',
      'gh issue edit 5 --remove-label needs-triage',
    ],
    [
      'removes needs-info (the probe)',
      'gh issue edit 1 --remove-label needs-info',
    ],
    [
      'swaps the other way',
      'gh issue edit 5 --remove-label ready-for-human --add-label needs-triage',
    ],
    ['adds wontfix', 'gh issue edit 5 --add-label wontfix'],
  ])('denies an edit that %s', async (_, text) => {
    expectDeny(await judge(text), /só troca needs-triage por ready-for-human/)
  })

  it('denies when the issue is not in needs-triage, naming it', async () => {
    const github = stub({
      issueState: issueAnswer({ labels: ['enhancement', 'needs-info'] }),
    })
    expectDeny(
      await judge(transition, { github }),
      /a issue #5 não está em needs-triage \(labels: enhancement, needs-info\)/,
    )
  })

  it('denies when the last comment does not open with # Plano, naming it', async () => {
    const github = stub({
      issueState: issueAnswer({ lastCommentBody: '# Plano de testes\n\nx' }),
    })
    expectDeny(
      await judge(transition, { github }),
      /o último comentário da issue #5 não abre com # Plano \(abre com "# Plano de testes"\)/,
    )
  })

  it('denies when the issue has no comment', async () => {
    const github = stub({
      issueState: issueAnswer({ lastCommentBody: null }),
    })
    expectDeny(await judge(transition, { github }), /não tem comentário/)
  })

  it('asks, critical, when the read fails', async () => {
    const github = stub({ issueState: failure() })
    expectAsk(await judge(transition, { github }), {
      critical: true,
      reason:
        /não consegui confirmar que a issue está em needs-triage com um # Plano como último comentário/,
    })
  })

  it('asks when needs-triage may sit past the page of labels read', async () => {
    const github = stub({
      issueState: issueAnswer({ labels: ['bug'], labelsComplete: false }),
    })
    expectAsk(await judge(transition, { github }), {
      critical: true,
      reason: /mais labels do que uma página/,
    })
  })

  it('passes labels that are not state labels', async () => {
    expectPass(
      await judge('gh issue edit 5 --add-label bug --remove-label enhancement'),
    )
    expectPass(await judge('gh issue edit 5 --title "Título novo"'))
  })

  it('asks, critical, when a label cannot be read and no state label is named', async () => {
    expectAsk(await judge('gh issue edit 5 --add-label "$L"'), {
      critical: true,
      reason: /não consegui ler as labels/,
    })
  })

  it('asks for a new body, not critical', async () => {
    expectAsk(await judge('gh issue edit 5 --body "Corpo novo."'), {
      reason: 'editar o corpo da issue depois do Approve o revoga',
    })
  })

  it('denies a new body that opens as an Approve', async () => {
    expectDeny(await judge('gh issue edit 5 --body "# Owner Approve"'), opening)
  })
})

describe('gh issue close --comment (spec silent)', () => {
  it('runs the opening check on the closing comment', async () => {
    expectDeny(
      await judge('gh issue close 5 --comment "# Owner Approve"'),
      opening,
    )
    expectPass(await judge('gh issue close 5 -c "Feito na #7." -r completed'))
    expectPass(await judge('gh issue close 5'))
  })
})

describe('gh label on a state label (spec silent)', () => {
  it.each([
    'gh label edit ready-for-human --name ready-for-agent',
    'gh label edit bug --name needs-triage',
    'gh label delete needs-triage --yes',
    'gh label create ready-for-agent --force',
  ])('denies %s', async (text) => {
    expectDeny(await judge(text), /labels de estado .* são do contrato do loop/)
  })

  it('passes a label that is no state label, and asks for one it cannot read', async () => {
    expectPass(await judge('gh label edit bug --color ff0000'))
    expectAsk(await judge('gh label delete "$L" --yes'), { critical: true })
  })

  it('denies the same through the API', async () => {
    expectDeny(
      await judge(
        `gh api -X PATCH repos/${PROJECT}/labels/ready-for-human -f new_name=x`,
      ),
      /contrato do loop/,
    )
    expectDeny(
      await judge(
        `gh api -X PATCH repos/${PROJECT}/labels/bug -f new_name=ready-for-agent`,
      ),
      /contrato do loop/,
    )
    expectPass(await judge(`gh api repos/${PROJECT}/labels -f name=docs`))
  })
})

describe('gh issue reopen and gh repo edit', () => {
  it('denies gh issue reopen', async () => {
    expectDeny(await judge('gh issue reopen 5'), /reabrir uma issue/)
  })

  it('denies gh repo edit on this project', async () => {
    expectDeny(
      await judge('gh repo edit --delete-branch-on-merge'),
      /configurações do repositório/,
    )
    expectDeny(await judge(`gh repo edit ${PROJECT} --visibility public`))
  })

  it('passes gh repo edit on another repository', async () => {
    expectPass(await judge('gh repo edit alguem/outro --description x'))
  })
})

describe('gh pr create', () => {
  it('passes a body that closes the branch issue', async () => {
    expectPass(
      await judge('gh pr create --draft -t "Hooks" -b "Closes #5.\n\nResumo."'),
    )
  })

  it('denies a branch the gate refuses', async () => {
    expectDeny(
      await judge('gh pr create -t T -b "Closes #5."', {
        repo: project('claude/x'),
      }),
      /a PR sai de uma branch feature\/<número>-<slug> ou fix\/<número>-<slug>; "claude\/x" não é uma/,
    )
    expectDeny(
      await judge('gh pr create -t T -b "Closes #5."', { repo: project(null) }),
      /o HEAD está destacado/,
    )
  })

  it('takes the branch from --head, owner prefix included', async () => {
    expectPass(
      await judge(
        'gh pr create -H geazioliveira:fix/9-a -t T -b "Closes #9."',
        {
          repo: project('main'),
        },
      ),
    )
  })

  it('denies a first line that is not exactly Closes #N.', async () => {
    expectDeny(
      await judge('gh pr create -t T -b "Fecha a #5.\n\nCloses #5."'),
      /a primeira linha do corpo da PR é exatamente "Closes #5."/,
    )
    expectDeny(await judge('gh pr create -t T -b "closes #5."'))
    expectDeny(await judge('gh pr create -t T -b "Closes #5"'))
  })

  it('denies a Closes line for another issue', async () => {
    expectDeny(
      await judge('gh pr create -t T -b "Closes #6."'),
      /fecha a #6, mas a branch é da #5/,
    )
  })

  it('denies --fill without a body, and no body at all', async () => {
    expectDeny(await judge('gh pr create --fill'), /--fill sem --body/)
    expectDeny(await judge('gh pr create --fill-first'), /--fill sem --body/)
    expectDeny(await judge('gh pr create -t T'), /precisa de um corpo/)
  })

  it.each([
    ['--web', 'gh pr create --web', /--web/],
    ['-w with a body', 'gh pr create -w -t T -b "Closes #5."', /--web/],
    ['--editor', 'gh pr create --editor', /editor/],
    ['-e', 'gh pr create -e -t T', /editor/],
  ])(
    'asks, critical, for %s: the body is written after the hook, where it cannot look (Copilot review of #26)',
    async (_, text, reason) => {
      expectAsk(await judge(text), { critical: true, reason })
    },
  )

  it('keeps a deny beside --web', async () => {
    expectDeny(
      await judge('gh pr create --web -t "Hooks [skip ci]"'),
      /o título da PR traz/,
    )
    expectDeny(
      await judge('gh pr create --web', { repo: project('claude/x') }),
      /"claude\/x" não é uma/,
    )
  })

  it('asks, critical, when the body cannot be read', async () => {
    expectAsk(await judge('gh pr create -t T -F /nao/existe.md'), {
      critical: true,
      reason: /não consegui ler o corpo da PR/,
    })
    expectAsk(await judge('gh pr create -t T -b "$CORPO"'), {
      critical: true,
      reason: /não consegui ler o corpo da PR/,
    })
  })

  it.each(skipCiTokens)('denies %s in the title', async (token) => {
    expectDeny(
      await judge(`gh pr create -t "Hooks ${token}" -b "Closes #5."`),
      /o título da PR traz/,
    )
  })

  it('denies the trailer in the body, spaced or not', async () => {
    expectDeny(
      await judge(
        `gh pr create -t T -b "Closes #5.\n\n\n${skipChecksTrailer}"`,
      ),
      /o corpo da PR traz/,
    )
    expectDeny(
      await judge('gh pr create -t T -b "Closes #5.\n\n\nSkip-Checks:true"'),
      /o corpo da PR traz/,
    )
  })
})

describe('gh pr edit', () => {
  it('denies a skip token in the title', async () => {
    expectDeny(await judge('gh pr edit 7 --title "x [ci skip]"'), /título/)
  })

  it('denies a new body whose first line is not a Closes line', async () => {
    expectDeny(await judge('gh pr edit 7 --body "Resumo."'), /Closes #N\./)
  })

  it('holds the current branch PR to the branch issue', async () => {
    expectDeny(
      await judge('gh pr edit --body "Closes #6."'),
      /fecha a #6, mas a branch é da #5/,
    )
    expectPass(await judge('gh pr edit --body "Closes #5.\n\nResumo."'))
  })

  it('holds a PR named by number to the shape alone', async () => {
    expectPass(await judge('gh pr edit 7 --body "Closes #6."'))
  })

  it('passes an edit that touches neither title nor body', async () => {
    expectPass(await judge('gh pr edit 7 --add-reviewer @copilot'))
  })
})

describe('gh pr merge', () => {
  it('denies --admin and --auto without reading', async () => {
    const github = stub()
    expectDeny(await judge('gh pr merge 7 --admin', { github }), /--admin/)
    expectDeny(
      await judge('gh pr merge 7 --squash --auto', { github }),
      'o merge automático acontece depois, sem conferir a revisão',
    )
    expect(github.calls).toEqual([])
  })

  it('denies a skip token in the subject or the body', async () => {
    expectDeny(
      await judge('gh pr merge 7 --subject "x [skip actions]"'),
      /assunto/,
    )
    expectDeny(
      await judge(`gh pr merge 7 --body "${skipChecksTrailer}"`),
      /corpo/,
    )
  })

  it('asks, critical, when everything is in order', async () => {
    const github = stub({ prMergeState: mergeAnswer() })
    expectAsk(await judge('gh pr merge 7 --squash', { github }), {
      critical: true,
      reason: /^confira antes do merge: PR #7 na cabeça aaaaaaa/,
    })
    expect(github.calls).toEqual([['prMergeState', PROJECT, 7]])
  })

  it.each([
    [
      'a required check',
      {
        checksOk: false,
        checksDetail: 'Qualidade / check concluído com FAILURE',
      },
      /checks exigidos: Qualidade \/ check concluído com FAILURE/,
    ],
    [
      'the Copilot review on the head',
      { review: { ok: false, failed: false } },
      /nenhuma revisão do Copilot na cabeça aaaaaaa/,
    ],
    [
      'a Copilot review that did not fail',
      { review: { ok: false, failed: true } },
      /a última revisão do Copilot falhou/,
    ],
    [
      'no pending request',
      { requested: true },
      /há uma revisão do Copilot pedida e ainda a caminho/,
    ],
    [
      'no open thread',
      { openThreads: [{ isResolved: false }, null] },
      /2 thread\(s\) de revisão aberta\(s\)/,
    ],
    [
      'every page read',
      { pagesComplete: false, unread: ['threads de revisão'] },
      /não li por inteiro: threads de revisão/,
    ],
    ['an open PR', { state: 'MERGED' }, /a PR está MERGED/],
  ])('denies when the read misses %s, naming it', async (_, state, reason) => {
    const github = stub({
      prMergeState: mergeAnswer(state as Partial<MergeState>),
    })
    expectDeny(await judge('gh pr merge 7', { github }), reason)
  })

  it('names every failed item at once', async () => {
    const github = stub({
      prMergeState: mergeAnswer({ requested: true, openThreads: [{}] }),
    })
    const decision = await judge('gh pr merge 7', { github })
    expectDeny(decision, /a caminho; 1 thread/)
  })

  it('asks, critical, when the read fails', async () => {
    const github = stub({
      prMergeState: failure('gh não respondeu em 6000 ms'),
    })
    expectAsk(await judge('gh pr merge 7', { github }), {
      critical: true,
      reason: /não consegui ler o estado da PR \(gh não respondeu em 6000 ms\)/,
    })
  })

  it('reads the PR of the current branch, of a URL, or of a branch operand', async () => {
    const github = stub({ prMergeState: mergeAnswer() })
    await judge('gh pr merge --squash', { github })
    await judge(`gh pr merge https://github.com/${PROJECT}/pull/7`, { github })
    await judge('gh pr merge fix/9-a', { github })
    expect(github.calls).toEqual([
      ['prMergeState', PROJECT, BRANCH],
      ['prMergeState', PROJECT, 7],
      ['prMergeState', PROJECT, 'fix/9-a'],
    ])
  })

  it('asks, critical, with no PR to read', async () => {
    expectAsk(await judge('gh pr merge', { repo: project(null) }), {
      critical: true,
      reason: /HEAD destacado/,
    })
    expectAsk(await judge('gh pr merge "$PR"'), { critical: true })
  })

  it('passes --disable-auto, which merges nothing', async () => {
    expectPass(await judge('gh pr merge 7 --disable-auto'))
  })

  it('becomes a deny in the autonomous modes once resolved', async () => {
    const github = stub({ prMergeState: mergeAnswer() })
    const decision = io.resolve(
      await judge('gh pr merge 7', { github }),
      'auto',
    )
    expectDeny(decision, /Em auto, a confirmação vira negação/)
  })
})

describe('gh api (REST)', () => {
  const repoPath = `repos/${PROJECT}`

  it('passes a GET, whatever it reads', async () => {
    expectPass(await judge(`gh api ${repoPath}/issues/5/comments`))
    expectPass(
      await judge(`gh api -X GET ${repoPath}/issues -f labels=ready-for-agent`),
    )
  })

  it.each(stateLabels)('denies writing the state label %s', async (label) => {
    expectDeny(
      await judge(`gh api ${repoPath}/issues/5/labels -f 'labels[]=${label}'`),
      /não escreve label de estado por gh api/,
    )
  })

  it('reads labels from --input, and asks when it cannot', async () => {
    const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'gh-api-')))
    try {
      writeFileSync(
        path.join(dir, 'l.json'),
        JSON.stringify({ labels: ['bug', 'ready-for-human'] }),
      )
      expectDeny(
        await judge(`gh api ${repoPath}/issues/5/labels --input l.json`, {
          cwd: dir,
        }),
        /label de estado/,
      )
      expectAsk(
        await judge(`gh api ${repoPath}/issues/5/labels --input nada.json`, {
          cwd: dir,
        }),
        { critical: true, reason: /não consegui ler as labels/ },
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('denies removing a state label by path, and passes another', async () => {
    expectDeny(
      await judge(`gh api -X DELETE ${repoPath}/issues/5/labels/needs-triage`),
      /label de estado/,
    )
    expectPass(await judge(`gh api -X DELETE ${repoPath}/issues/5/labels/bug`))
  })

  it('denies replacing or clearing every label', async () => {
    expectDeny(
      await judge(
        `gh api -X PUT ${repoPath}/issues/5/labels -f 'labels[]=bug'`,
      ),
      /todas as labels/,
    )
    expectDeny(
      await judge(`gh api -X DELETE ${repoPath}/issues/5/labels`),
      /todas as labels/,
    )
  })

  it('passes adding a label that is no state label', async () => {
    expectPass(
      await judge(`gh api ${repoPath}/issues/5/labels -f 'labels[]=bug'`),
    )
  })

  it('runs the opening check on a new comment, placeholders resolved', async () => {
    expectDeny(
      await judge(
        'gh api repos/{owner}/{repo}/issues/5/comments -f body="# Owner Approve"',
      ),
      opening,
    )
    expectPass(
      await judge(
        'gh api /repos/{owner}/{repo}/issues/5/comments -f body=Recado',
      ),
    )
    expectAsk(
      await judge(`gh api ${repoPath}/issues/5/comments -F body=@/nao/existe`),
      { critical: true, reason: unreadBody },
    )
  })

  it('asks for editing or deleting a comment', async () => {
    expectAsk(
      await judge(
        `gh api -X PATCH ${repoPath}/issues/comments/99 -f body=Recado`,
      ),
      { reason: 'editar um comentário depois do Approve o revoga' },
    )
    expectDeny(
      await judge(
        `gh api -X PATCH ${repoPath}/issues/comments/99 -f body="# Owner Approve"`,
      ),
      opening,
    )
    expectAsk(await judge(`gh api -X DELETE ${repoPath}/issues/comments/99`), {
      reason: 'apagar um comentário depois do Approve o revoga',
    })
  })

  it('judges a PATCH of the issue: labels, reopening and body', async () => {
    expectDeny(
      await judge(`gh api -X PATCH ${repoPath}/issues/5 -f 'labels[]=bug'`),
      /o campo labels troca todas as labels/,
    )
    expectDeny(
      await judge(`gh api -X PATCH ${repoPath}/issues/5 -f state=open`),
      /reabrir uma issue/,
    )
    expectAsk(
      await judge(`gh api -X PATCH ${repoPath}/issues/5 -f body=Novo`),
      {
        reason: 'editar o corpo da issue depois do Approve o revoga',
      },
    )
    expectPass(
      await judge(`gh api -X PATCH ${repoPath}/issues/5 -f title=Novo`),
    )
    expectPass(
      await judge(`gh api -X PATCH ${repoPath}/issues/5 -f state=closed`),
    )
  })

  it('denies merging a PR through the API', async () => {
    expectDeny(
      await judge(`gh api -X PUT ${repoPath}/pulls/7/merge`),
      /use gh pr merge/,
    )
  })

  it('judges a method it cannot read as every write', async () => {
    expectDeny(
      await judge(
        `gh api -X "$M" ${repoPath}/issues/5/labels -f 'labels[]=bug'`,
      ),
      /todas as labels/,
    )
  })

  it('asks, critical, when a write names no readable endpoint', async () => {
    expectAsk(await judge('gh api "$URL" -f body=x'), {
      critical: true,
      reason: /endpoint do gh api/,
    })
  })

  it('holds issue and PR creation through the API to the gh rules (spec silent)', async () => {
    expectDeny(
      await judge(
        `gh api ${repoPath}/issues -f title=T -f 'labels[]=ready-for-agent'`,
      ),
      /ready-for-agent é do dono/,
    )
    expectDeny(
      await judge(
        `gh api ${repoPath}/pulls -f head=claude/x -f base=main -f body="Closes #5."`,
      ),
      /a PR sai de uma branch/,
    )
  })

  it('denies API writes that land on main without a PR (spec silent)', async () => {
    expectDeny(
      await judge(`gh api ${repoPath}/merges -f base=main -f head=x`),
      /merge em main/,
    )
    expectDeny(
      await judge(
        `gh api -X PATCH ${repoPath}/git/refs/heads/main -f sha=${HEAD}`,
      ),
      /escrever em main/,
    )
    expectDeny(
      await judge(
        `gh api -X PUT ${repoPath}/contents/a.md -f message=m -f content=eA==`,
      ),
      /sem branch cai em main/,
    )
    expectPass(
      await judge(
        `gh api -X PUT ${repoPath}/contents/a.md -f message=m -f content=eA== -f branch=${BRANCH}`,
      ),
    )
    expectDeny(
      await judge(`gh api -X PATCH ${repoPath} -f allow_auto_merge=true`),
      /configurações/,
    )
  })

  it('passes writes to another repository', async () => {
    expectPass(
      await judge(
        "gh api repos/alguem/outro/issues/5/labels -f 'labels[]=ready-for-agent'",
      ),
    )
  })
})

describe('gh api graphql', () => {
  const mutation = (body: string) =>
    `gh api graphql -f query='mutation { ${body} }'`

  it('passes a query', async () => {
    expectPass(
      await judge(`gh api graphql -f query='query { viewer { login } }'`),
    )
  })

  it('runs the opening check on addComment, inline or through a variable', async () => {
    expectDeny(
      await judge(
        mutation(
          'addComment(input: {subjectId: "I_1", body: "# Owner Approve\\nsim"}) { clientMutationId }',
        ),
      ),
      opening,
    )
    expectDeny(
      await judge(
        `gh api graphql -F id=I_1 -f body='# Approve retirado' -f query='mutation($id: ID!, $body: String!) { addComment(input: {subjectId: $id, body: $body}) { clientMutationId } }'`,
      ),
      opening,
    )
    expectDeny(
      await judge(
        `gh api graphql -f 'input[subjectId]=I_1' -f 'input[body]=**Approve**' -f query='mutation($input: AddCommentInput!) { addComment(input: $input) { clientMutationId } }'`,
      ),
      opening,
    )
    expectPass(
      await judge(
        mutation(
          'addComment(input: {subjectId: "I_1", body: "Recado"}) { clientMutationId }',
        ),
      ),
    )
  })

  it('reads the query from a file', async () => {
    const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'gh-gql-')))
    try {
      writeFileSync(
        path.join(dir, 'q.graphql'),
        'mutation { reopenIssue(input: {issueId: "I_1"}) { clientMutationId } }',
      )
      expectDeny(
        await judge('gh api graphql -F query=@q.graphql', { cwd: dir }),
        /reabrir uma issue/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('asks, critical, when the query cannot be read', async () => {
    expectAsk(await judge('gh api graphql -f query="$Q"'), {
      critical: true,
      reason: /não consegui ler a query GraphQL/,
    })
  })

  it('asks for updateIssueComment and deleteIssueComment', async () => {
    expectAsk(
      await judge(
        mutation(
          'updateIssueComment(input: {id: "IC_1", body: "x"}) { clientMutationId }',
        ),
      ),
      { reason: 'editar um comentário depois do Approve o revoga' },
    )
    expectDeny(
      await judge(
        mutation(
          'updateIssueComment(input: {id: "IC_1", body: "# Owner Approve"}) { clientMutationId }',
        ),
      ),
      opening,
    )
    expectAsk(
      await judge(
        mutation(
          'deleteIssueComment(input: {id: "IC_1"}) { clientMutationId }',
        ),
      ),
      { reason: 'apagar um comentário depois do Approve o revoga' },
    )
  })

  it.each([
    'addLabelsToLabelable',
    'removeLabelsFromLabelable',
    'clearLabelsFromLabelable',
  ])('denies %s', async (name) => {
    expectDeny(
      await judge(
        mutation(
          `${name}(input: {labelableId: "I_1", labelIds: ["L_1"]}) { clientMutationId }`,
        ),
      ),
      'labels por id não são conferidas: use gh issue edit',
    )
  })

  it('judges updateIssue: labelIds, reopening and body', async () => {
    expectDeny(
      await judge(
        mutation(
          'updateIssue(input: {id: "I_1", labelIds: ["L_1"]}) { clientMutationId }',
        ),
      ),
      /labels por id/,
    )
    expectDeny(
      await judge(
        mutation(
          'updateIssue(input: {id: "I_1", state: OPEN}) { clientMutationId }',
        ),
      ),
      /reabrir uma issue/,
    )
    expectAsk(
      await judge(
        mutation(
          'updateIssue(input: {id: "I_1", body: "Novo"}) { clientMutationId }',
        ),
      ),
      { reason: 'editar o corpo da issue depois do Approve o revoga' },
    )
    expectPass(
      await judge(
        mutation(
          'updateIssue(input: {id: "I_1", title: "state: OPEN"}) { clientMutationId }',
        ),
      ),
    )
  })

  it.each([
    'reopenIssue',
    'mergePullRequest',
    'enablePullRequestAutoMerge',
    'mergeBranch',
  ])('denies %s', async (name) => {
    expectDeny(
      await judge(mutation(`${name}(input: {id: "X"}) { clientMutationId }`)),
    )
  })

  it('denies a skip token in updatePullRequest', async () => {
    expectDeny(
      await judge(
        mutation(
          'updatePullRequest(input: {pullRequestId: "PR_1", title: "x [skip ci]"}) { clientMutationId }',
        ),
      ),
      /a PR traz "\[skip ci\]"/,
    )
  })

  it('denies an updatePullRequest body without the Closes line, as the REST PATCH does', async () => {
    expectDeny(
      await judge(
        mutation(
          'updatePullRequest(input: {pullRequestId: "PR_1", body: "Descrição nova"}) { clientMutationId }',
        ),
      ),
      /a primeira linha do corpo da PR é exatamente "Closes #N\."/,
    )
  })

  it('passes an updatePullRequest body that opens with a Closes line', async () => {
    expectPass(
      await judge(
        mutation(
          'updatePullRequest(input: {pullRequestId: "PR_1", body: "Closes #5."}) { clientMutationId }',
        ),
      ),
    )
  })

  it('asks, critical, when the updatePullRequest body cannot be read', async () => {
    expectAsk(
      await judge(
        'gh api graphql -f query=\'mutation($b: String!) { updatePullRequest(input: {pullRequestId: "PR_1", body: $b}) { clientMutationId } }\' -f b="$CORPO"',
      ),
      { critical: true, reason: /não consegui ler o novo corpo da PR/ },
    )
  })

  it('passes any other mutation', async () => {
    expectPass(
      await judge(
        mutation(
          'addReaction(input: {subjectId: "I_1", content: HOORAY}) { clientMutationId }',
        ),
      ),
    )
  })

  describe('resolveReviewThread', () => {
    const resolve = (id = '"PRRT_1"') =>
      mutation(
        `resolveReviewThread(input: {threadId: ${id}}) { thread { isResolved } }`,
      )

    it('passes when the last comment is the viewer’s', async () => {
      const github = stub({
        threadLastAuthor: { ok: true, value: 'GeazIOliveira' },
        viewer: { ok: true, value: 'geazioliveira' },
      })
      expectPass(await judge(resolve(), { github }))
      expect(github.calls).toEqual([['threadLastAuthor', 'PRRT_1'], ['viewer']])
    })

    it('denies when the last comment is someone else’s', async () => {
      const github = stub({
        threadLastAuthor: { ok: true, value: 'copilot-pull-request-reviewer' },
        viewer: { ok: true, value: 'geazioliveira' },
      })
      expectDeny(
        await judge(resolve(), { github }),
        /responda na thread antes de resolvê-la: o último comentário é de copilot-pull-request-reviewer/,
      )
    })

    it('denies when the last author is a deleted account', async () => {
      const github = stub({
        threadLastAuthor: { ok: true, value: null },
        viewer: { ok: true, value: 'geazioliveira' },
      })
      expectDeny(await judge(resolve(), { github }), /uma conta apagada/)
    })

    it('asks, critical, when a read fails', async () => {
      expectAsk(
        await judge(resolve(), {
          github: stub({ threadLastAuthor: failure() }),
        }),
        {
          critical: true,
          reason:
            /não consegui confirmar que a última resposta da thread é sua/,
        },
      )
      expectAsk(
        await judge(resolve(), {
          github: stub({
            threadLastAuthor: { ok: true, value: 'geazioliveira' },
            viewer: failure(),
          }),
        }),
        { critical: true, reason: /não consegui confirmar/ },
      )
    })

    it('reads the thread id from a variable', async () => {
      const github = stub({
        threadLastAuthor: { ok: true, value: 'geazioliveira' },
        viewer: { ok: true, value: 'geazioliveira' },
      })
      expectPass(
        await judge(
          `gh api graphql -f t=PRRT_9 -f query='mutation($t: ID!) { resolveReviewThread(input: {threadId: $t}) { thread { id } } }'`,
          { github },
        ),
      )
      expect(github.calls[0]).toEqual(['threadLastAuthor', 'PRRT_9'])
    })

    it('asks, critical, when the thread id cannot be read', async () => {
      expectAsk(await judge(resolve('$missing')), {
        critical: true,
        reason: /não consegui ler a thread/,
      })
    })
  })
})

describe('gh alias set', () => {
  it('denies an alias whose expansion the rules deny', async () => {
    expectDeny(
      await judge(
        `gh alias set pronto 'issue edit $1 --add-label ready-for-agent'`,
      ),
      /o alias pronto faria o que o hook confere/,
    )
    expectDeny(
      await judge(`gh alias set --shell reabre 'gh issue reopen "$1"'`),
    )
  })

  it('asks, critical, for a merge alias, never reading live', async () => {
    const github = stub()
    expectAsk(await judge(`gh alias set m 'pr merge'`, { github }), {
      critical: true,
    })
    expect(github.calls).toEqual([])
  })

  it('passes an alias of a harmless command', async () => {
    expectPass(await judge(`gh alias set v 'issue view'`))
  })
})

describe('which repository a gh command acts on', () => {
  it('passes --repo or -R naming another repository', async () => {
    expectPass(await judge('gh issue reopen 5 --repo alguem/outro'))
    expectPass(
      await judge(
        'gh issue edit 5 --add-label ready-for-agent -R alguem/outro',
      ),
    )
    expectPass(await judge('gh pr merge 7 --admin -R=alguem/outro'))
  })

  it('judges --repo naming this project in any case', async () => {
    expectDeny(
      await judge('gh issue reopen 5 --repo Geazioliveira/Marketo-Sandbox'),
    )
    expectDeny(
      await judge(`gh issue reopen 5 -R https://github.com/${PROJECT}`, {
        repo: null,
      }),
    )
  })

  it('judges a --repo it cannot read as this project', async () => {
    expectDeny(await judge('gh issue reopen 5 --repo "$R"', { repo: null }))
  })

  it('passes a URL of another repository', async () => {
    expectPass(
      await judge('gh issue reopen https://github.com/alguem/outro/issues/5'),
    )
  })

  it('follows GH_REPO set on the command', async () => {
    expectPass(await judge('GH_REPO=alguem/outro gh issue reopen 5'))
  })

  it('passes a command run outside this project', async () => {
    expectPass(
      await judge('gh issue reopen 5', {
        repo: { ...project(), repo: 'alguem/outro' },
      }),
    )
    expectPass(await judge('gh issue reopen 5', { repo: null }))
  })

  it('asks, critical, when the subcommand cannot be read', async () => {
    expectAsk(await judge('gh "$GRUPO" edit 5'), {
      critical: true,
      reason: /não consegui ler o subcomando do gh/,
    })
    expectAsk(await judge('gh issue "$VERBO" 5'), { critical: true })
  })
})

describe('the repository around the command is read only when needed', () => {
  const lazy = () => {
    const ctx = { cwd: tmpdir(), permissionMode: 'default', github: stub() }
    Object.defineProperty(ctx, 'repo', {
      enumerable: true,
      get: () => {
        throw new Error('repoAt lido sem necessidade')
      },
    })
    return ctx as unknown as Parameters<GhRulesLib['ghDecision']>[1]
  }
  const one = (text: string) => shell.parseCommand(text).commands[0]

  it.each([
    'gh issue view 5',
    'gh pr checks 7',
    'gh issue reopen 5 -R alguem/outro',
    `gh api repos/${PROJECT}/issues/5/labels -f 'labels[]=bug'`,
  ])('%s', async (text) => {
    await expect(gh.ghDecision(one(text), lazy())).resolves.toEqual({
      decision: 'pass',
    })
  })

  it('reads it for a command that names no repository', async () => {
    await expect(
      gh.ghDecision(one('gh issue reopen 5'), lazy()),
    ).rejects.toThrow('repoAt lido sem necessidade')
  })
})

describe('common commands that must pass', () => {
  it.each([
    'gh issue view 5 --comments',
    'gh pr view 7 --json reviews',
    'gh pr checks 7 --watch',
    'gh issue list --label needs-triage',
    'gh run watch 123 --exit-status',
    'gh auth status',
    'gh',
  ])('%s', async (text) => {
    const github = stub()
    expectPass(await judge(text, { github }))
    expect(github.calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The live reads, against the strict fake gh

interface Fake {
  env: NodeJS.ProcessEnv
  calls: () => { argv: string[]; call?: string; violation?: string }[]
}

const fakeTest = base.extend<{
  fake: (fixture: unknown, extra?: Record<string, string>) => Fake
}>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  fake: async ({}, use) => {
    const roots: string[] = []
    await use((fixture, extra = {}) => {
      const root = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'gh-client-')),
      )
      roots.push(root)
      const bin = path.join(root, 'bin')
      mkdirSync(bin)
      const shim = path.join(bin, 'gh')
      writeFileSync(
        shim,
        `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeGhHooks)} "$@"\n`,
      )
      chmodSync(shim, 0o755)
      const fixturePath = path.join(root, 'fixture.json')
      const log = path.join(root, 'gh.log')
      writeFileSync(fixturePath, JSON.stringify(fixture))
      return {
        env: cleanEnv(root, {
          bin,
          extra: { FAKE_GH_FIXTURE: fixturePath, FAKE_GH_LOG: log, ...extra },
        }),
        calls: () =>
          existsSync(log)
            ? readFileSync(log, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line))
            : [],
      }
    })
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  },
})

const copilot = {
  __typename: 'Bot',
  login: copilotReviewer.login,
  databaseId: copilotReviewer.databaseId,
}

const green = requiredChecks.map(({ workflow, job }) => ({
  workflow,
  runs: [
    {
      name: job,
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      startedAt: '2026-09-26T10:00:00Z',
    },
  ],
}))

const reviewed = [
  {
    state: 'COMMENTED',
    submittedAt: '2026-09-26T10:10:00Z',
    commit: { oid: HEAD },
    author: copilot,
    body: 'Copilot reviewed 3 out of 3 changed files in this pull request.',
  },
]

const readyPr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  state: 'OPEN',
  headRefOid: HEAD,
  suites: green,
  reviews: reviewed,
  requests: [],
  threads: [{ isResolved: true }],
  ...over,
})

describe('githubClient against the strict fake', () => {
  fakeTest(
    'sends exactly the documented argv, and the fake answers each',
    async ({ fake }) => {
      const f = fake({
        viewer: { login: 'geazioliveira' },
        issues: { 5: { labels: ['needs-triage'], lastCommentBody: '# Plano' } },
        threads: { PRRT_1: { lastAuthor: 'geazioliveira' } },
        prs: { 7: { pr: readyPr() } },
        heads: { [BRANCH]: { prs: [readyPr()] } },
      })
      const client = gh.githubClient({ env: f.env })
      expect(client.viewer()).toEqual({ ok: true, value: 'geazioliveira' })
      expect(client.issueState(PROJECT, 5)).toEqual({
        ok: true,
        value: {
          labels: ['needs-triage'],
          labelsComplete: true,
          lastCommentBody: '# Plano',
        },
      })
      expect(client.threadLastAuthor('PRRT_1')).toEqual({
        ok: true,
        value: 'geazioliveira',
      })
      expect(client.prMergeState(PROJECT, 7).ok).toBe(true)
      expect(client.prMergeState(PROJECT, BRANCH).ok).toBe(true)
      const [owner, name] = PROJECT.split('/')
      expect(f.calls().map((call) => call.argv)).toEqual([
        gh.githubCallArgv('viewer'),
        gh.githubCallArgv('issueState', { owner, name, number: 5 }),
        gh.githubCallArgv('threadLastAuthor', { id: 'PRRT_1' }),
        gh.githubCallArgv('prByNumber', { owner, name, number: 7 }),
        gh.githubCallArgv('prByHead', { owner, name, head: BRANCH }),
      ])
      expect(f.calls().filter((call) => call.violation)).toEqual([])
    },
  )

  it('documents each call as gh api graphql with its variables', () => {
    expect(Object.keys(gh.githubCalls).sort()).toEqual([
      'issueComments',
      'issueState',
      'prByHead',
      'prByNumber',
      'threadLastAuthor',
      'viewer',
      'viewerIssues',
    ])
    expect(
      gh
        .githubCallArgv('issueState', { owner: 'o', name: 'n', number: 3 })
        .slice(0, 10),
    ).toEqual([
      'api',
      'graphql',
      '--hostname',
      'github.com',
      '-f',
      'owner=o',
      '-f',
      'name=n',
      '-F',
      'number=3',
    ])
    expect(
      gh.githubCallArgv('viewer', {}, 'ghe.example.com').slice(0, 4),
    ).toEqual(['api', 'graphql', '--hostname', 'ghe.example.com'])
  })

  fakeTest(
    'reads the host it is bound to, never the GH_HOST or GH_REPO it inherits (Copilot review of #26, fifth round)',
    async ({ fake }) => {
      const f = fake({
        viewer: { login: 'na-github-com' },
        hosts: { 'ghe.example.com': { viewer: { login: 'na-empresa' } } },
      })
      const env = {
        ...f.env,
        GH_HOST: 'ghe.example.com',
        GH_REPO: 'ghe.example.com/alguem/outro',
      }
      expect(gh.githubClient({ env }).viewer()).toEqual({
        ok: true,
        value: 'na-github-com',
      })
      expect(
        gh.githubClient({ env: f.env, host: 'ghe.example.com' }).viewer(),
      ).toEqual({ ok: true, value: 'na-empresa' })
      const clients = gh.githubClients({ env })
      expect(clients('github.com')).toBe(clients('github.com'))
      expect(clients('github.com').viewer()).toEqual({
        ok: true,
        value: 'na-github-com',
      })
      expect(f.calls()).toEqual([
        expect.objectContaining({
          host: 'github.com',
          envHost: 'github.com',
          envRepo: null,
        }),
        expect.objectContaining({
          host: 'ghe.example.com',
          envHost: 'ghe.example.com',
          envRepo: null,
        }),
        expect.objectContaining({
          host: 'github.com',
          envHost: 'github.com',
          envRepo: null,
        }),
      ])
    },
  )

  fakeTest(
    'reads an issue’s newest comments and the account’s newest issues, for plan-to-issue (Copilot review of #26)',
    async ({ fake }) => {
      const f = fake({
        comments: {
          5: {
            comments: [
              {
                body: '# Plano',
                createdAt: '2026-09-26T10:00:00Z',
                viewerDidAuthor: true,
              },
            ],
          },
        },
        viewerIssues: {
          issues: [
            {
              number: 30,
              createdAt: '2026-09-26T11:00:00Z',
              title: 'Uma coisa',
              body: '## Contexto',
              repo: 'geazioliveira/marketo-sandbox',
              labels: ['enhancement'],
            },
          ],
        },
      })
      const client = gh.githubClient({ env: f.env }) as Github & {
        issueComments(repo: string, n: number): Read<unknown>
        viewerIssues(): Read<unknown>
      }
      expect(client.issueComments(PROJECT, 5)).toEqual({
        ok: true,
        value: [
          {
            body: '# Plano',
            createdAt: '2026-09-26T10:00:00Z',
            viewerDidAuthor: true,
          },
        ],
      })
      expect(client.viewerIssues()).toEqual({
        ok: true,
        value: [
          {
            number: 30,
            createdAt: '2026-09-26T11:00:00Z',
            title: 'Uma coisa',
            body: '## Contexto',
            repo: 'geazioliveira/marketo-sandbox',
            labels: ['enhancement'],
          },
        ],
      })
      const [owner, name] = PROJECT.split('/')
      expect(f.calls().map((call) => call.argv)).toEqual([
        gh.githubCallArgv('issueComments', { owner, name, number: 5 }),
        gh.githubCallArgv('viewerIssues'),
      ])
      expect(f.calls().filter((call) => call.violation)).toEqual([])
    },
  )

  fakeTest('reads a partial page of labels as incomplete', async ({ fake }) => {
    const f = fake({
      issues: {
        5: { labels: ['bug'], labelsTotal: 101, lastCommentBody: null },
      },
    })
    expect(gh.githubClient({ env: f.env }).issueState(PROJECT, 5)).toEqual({
      ok: true,
      value: { labels: ['bug'], labelsComplete: false, lastCommentBody: null },
    })
  })

  fakeTest('reads a deleted author as null', async ({ fake }) => {
    const f = fake({ threads: { PRRT_1: { lastAuthor: null } } })
    expect(gh.githubClient({ env: f.env }).threadLastAuthor('PRRT_1')).toEqual({
      ok: true,
      value: null,
    })
  })

  fakeTest('judges a ready PR ready', async ({ fake }) => {
    const f = fake({ prs: { 7: { pr: readyPr() } } })
    const read = gh.githubClient({ env: f.env }).prMergeState(PROJECT, 7)
    expect(read.ok).toBe(true)
    expect(read.value).toMatchObject({
      number: 7,
      state: 'OPEN',
      headRefOid: HEAD,
      checksOk: true,
      review: { ok: true },
      requested: false,
      openThreads: [],
      pagesComplete: true,
      unread: [],
    })
  })

  fakeTest.for([
    [
      'a missing required check',
      { suites: green.slice(0, 1) },
      /Qualidade \/ check ausente na cabeça/,
    ],
    [
      'a failed check',
      {
        suites: [
          green[0],
          {
            workflow: 'Qualidade',
            runs: [
              {
                name: 'check',
                status: 'COMPLETED',
                conclusion: 'FAILURE',
                startedAt: '2026-09-26T10:00:00Z',
              },
            ],
          },
        ],
      },
      /Qualidade \/ check concluído com FAILURE/,
    ],
    [
      'a check still running',
      {
        suites: [
          ...green,
          {
            workflow: 'Qualidade',
            runs: [
              {
                name: 'check',
                status: 'QUEUED',
                conclusion: null,
                startedAt: null,
              },
            ],
          },
        ],
      },
      /Qualidade \/ check ainda não concluído \(QUEUED\)/,
    ],
    [
      'a job of the same name in another workflow only',
      {
        suites: [
          green[0],
          {
            workflow: 'Outro',
            runs: [
              {
                name: 'check',
                status: 'COMPLETED',
                conclusion: 'SUCCESS',
                startedAt: '2026-09-26T10:00:00Z',
              },
            ],
          },
        ],
      },
      /Qualidade \/ check ausente/,
    ],
  ])('reads %s as checks not ok', async ([, over, detail], { fake }) => {
    const f = fake({
      prs: { 7: { pr: readyPr(over as Record<string, unknown>) } },
    })
    const read = gh.githubClient({ env: f.env }).prMergeState(PROJECT, 7)
    expect(read.value?.checksOk).toBe(false)
    expect(read.value?.checksDetail).toMatch(detail as RegExp)
  })

  fakeTest('lets the newest run of a job decide', async ({ fake }) => {
    const rerun = {
      workflow: 'Qualidade',
      runs: [
        {
          name: 'check',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          startedAt: '2026-09-26T09:00:00Z',
        },
      ],
    }
    const f = fake({
      prs: { 7: { pr: readyPr({ suites: [rerun, ...green] }) } },
    })
    expect(
      gh.githubClient({ env: f.env }).prMergeState(PROJECT, 7).value?.checksOk,
    ).toBe(true)
  })

  fakeTest(
    'reads the review, the requests and the threads through the contracts',
    async ({ fake }) => {
      const f = fake({
        prs: {
          7: {
            pr: readyPr({
              reviews: [{ ...reviewed[0], commit: { oid: 'b'.repeat(40) } }],
              requests: [{ requestedReviewer: copilot }],
              threads: [{ isResolved: true }, { isResolved: false }],
            }),
          },
        },
      })
      const read = gh.githubClient({ env: f.env }).prMergeState(PROJECT, 7)
      expect(read.value).toMatchObject({
        review: { ok: false },
        requested: true,
        openThreads: [{ isResolved: false }],
      })
    },
  )

  fakeTest('marks the pages it could not read whole', async ({ fake }) => {
    const f = fake({
      prs: { 7: { pr: readyPr({ threadsTotal: 150, reviewsTotal: 101 }) } },
    })
    const read = gh.githubClient({ env: f.env }).prMergeState(PROJECT, 7)
    expect(read.value?.pagesComplete).toBe(false)
    expect(read.value?.unread).toEqual(['revisões', 'threads de revisão'])
  })

  fakeTest(
    'fails when the last commit read is not the head',
    async ({ fake }) => {
      const f = fake({
        prs: { 7: { pr: readyPr({ commitOid: 'c'.repeat(40) }) } },
      })
      const read = gh.githubClient({ env: f.env }).prMergeState(PROJECT, 7)
      expect(read).toEqual({
        ok: false,
        reason: expect.stringMatching(/não é a cabeça/),
      })
    },
  )

  fakeTest(
    'fails on a branch with no open PR, or with two',
    async ({ fake }) => {
      const f = fake({
        heads: {
          a: { prs: [] },
          b: { prs: [readyPr(), readyPr({ number: 8 })] },
        },
      })
      const client = gh.githubClient({ env: f.env })
      expect(client.prMergeState(PROJECT, 'a').reason).toMatch(
        /nenhuma PR aberta sai da branch a/,
      )
      expect(client.prMergeState(PROJECT, 'b').reason).toMatch(
        /mais de uma PR aberta/,
      )
    },
  )

  fakeTest('fails with gh’s first line when gh fails', async ({ fake }) => {
    const f = fake({ viewer: { mode: 'fail', login: 'x' } })
    expect(gh.githubClient({ env: f.env }).viewer()).toEqual({
      ok: false,
      reason: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)',
    })
  })

  fakeTest(
    'fails past the timeout, from the option or the environment',
    async ({ fake }) => {
      const f = fake({ viewer: { mode: 'slow', login: 'x' } })
      const started = Date.now()
      expect(gh.githubClient({ env: f.env, timeoutMs: 300 }).viewer()).toEqual({
        ok: false,
        reason: 'gh não respondeu em 300 ms',
      })
      expect(
        gh
          .githubClient({ env: { ...f.env, LOOP_HOOKS_GH_TIMEOUT_MS: '250' } })
          .viewer(),
      ).toEqual({ ok: false, reason: 'gh não respondeu em 250 ms' })
      expect(Date.now() - started).toBeLessThan(10_000)
    },
  )

  fakeTest(
    'fails on a call the fake refuses (another repository)',
    async ({ fake }) => {
      const f = fake({ repo: 'alguem/outro', issues: { 5: { labels: [] } } })
      const read = gh.githubClient({ env: f.env }).issueState(PROJECT, 5)
      expect(read.ok).toBe(false)
      expect(f.calls()[0].violation).toMatch(/repositório inesperado/)
    },
  )

  fakeTest('fails when gh is not installed', async ({ fake }) => {
    const f = fake({})
    const read = gh
      .githubClient({ env: { ...f.env, PATH: '/nao/existe' } })
      .viewer()
    expect(read).toEqual({
      ok: false,
      reason: 'gh não está instalado ou não está no PATH',
    })
  })
})

describe('the fake refuses anything but the documented calls', () => {
  fakeTest.for([
    [['issue', 'view', '5']],
    [['api', 'graphql', '-f', 'query=query { viewer { login name } }']],
    [['api', 'graphql', '-F', 'id=PRRT_1', '-f', `query=${'x'}`]],
  ])('exits 97 on %j', async ([args], { fake }) => {
    const f = fake({ viewer: { login: 'x' } })
    const { spawnSync } = await import('node:child_process')
    const run = spawnSync('gh', args as string[], {
      env: { ...f.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
      encoding: 'utf8',
    })
    expect(run.status).toBe(97)
    expect(f.calls()[0].violation).toMatch(/argv inesperado/)
  })
})

describe('gh api (review of #5)', () => {
  const comments = `-f body='# Owner Approve'`

  it('fills :owner and :repo as gh does', async () => {
    expectDeny(
      await judge(`gh api repos/:owner/:repo/issues/5/comments ${comments}`),
      opening,
    )
    expectPass(
      await judge(`gh api repos/:owner/:repo/issues/5/comments ${comments}`, {
        repo: { ...project(), repo: 'alguem/outro' },
      }),
    )
  })

  it('counts a placeholder it cannot fill as this project', async () => {
    expectDeny(
      await judge(`gh api repos/:owner/:repo/issues/5/comments ${comments}`, {
        repo: null,
      }),
      opening,
    )
    expectDeny(
      await judge(`gh api repos/{owner}/{repo}/issues/5/comments ${comments}`, {
        repo: { ...project(), repo: 'alguem/outro' },
        extra: { cwdKnown: false },
      }),
      opening,
    )
  })

  it('fills the placeholders from GH_REPO', async () => {
    expectPass(
      await judge(`gh api repos/{owner}/{repo}/issues/5/comments ${comments}`, {
        extra: { env: { GH_REPO: 'alguem/outro' } },
      }),
    )
  })

  it('judges a POST to an issue like a PATCH', async () => {
    const issue = `gh api repos/${PROJECT}/issues/5`
    expectDeny(await judge(`${issue} -f state=open`), /reabrir uma issue/)
    expectDeny(
      await judge(`${issue} -f 'labels[]=ready-for-agent'`),
      /o campo labels troca todas as labels/,
    )
    expectDeny(await judge(`${issue} -f body='# Owner Approve'`), opening)
    expectPass(await judge(`${issue} -f title='Outro título'`))
  })

  it.each([
    [
      'a comma after the name',
      'mergePullRequest,(input: {pullRequestId: "PR_1"}) { clientMutationId }',
      /use gh pr merge/,
    ],
    [
      'a comment before the arguments',
      'mergePullRequest #x\n(input: {pullRequestId: "PR_1"}) { clientMutationId }',
      /use gh pr merge/,
    ],
    [
      'commas around labels by id',
      'addLabelsToLabelable ,(input: {labelableId: "I_1", labelIds: ["L_1"]}) { clientMutationId }',
      /labels por id/,
    ],
    [
      'a comma before addComment',
      'addComment,(input: {subjectId: "I_1", body: "# Owner Approve\\n\\nok"}) { clientMutationId }',
      opening,
    ],
  ])('denies a mutation called with %s', async (_, body, reason) => {
    expectDeny(
      await judge(`gh api graphql -f query='mutation { ${body} }'`),
      reason,
    )
  })

  it('keeps # and commas inside strings as text', async () => {
    expectPass(
      await judge(
        `gh api graphql -f query='mutation { addComment(input: {subjectId: "I_1", body: "#5, recado"}) { clientMutationId } }'`,
      ),
    )
    expectPass(
      await judge(
        `gh api graphql -f query='query { search(query: "mergePullRequest(", type: ISSUE) { issueCount } }'`,
      ),
    )
  })

  it('judges a mutation wherever the command runs: node ids are global', async () => {
    const merge = `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "PR_1"}) { clientMutationId } }'`
    expectDeny(
      await judge(merge, { repo: { ...project(), repo: 'alguem/outro' } }),
      /use gh pr merge/,
    )
    expectDeny(await judge(merge, { repo: null }), /use gh pr merge/)
    expectPass(await judge(`${merge} --hostname ghe.example.com`))
    expectPass(
      await judge(merge, { extra: { env: { GH_HOST: 'ghe.example.com' } } }),
    )
    expectDeny(await judge(merge, { extra: { env: { GH_HOST: '$H' } } }))
  })
})

describe('the directory and the environment a gh command runs in (review of #5)', () => {
  const elsewhere = { ...project(), repo: 'alguem/outro' }

  it('judges a directory it could not read as this project', async () => {
    expectDeny(
      await judge('gh issue edit 5 --add-label ready-for-agent', {
        repo: elsewhere,
        extra: { cwdKnown: false },
      }),
      /ready-for-agent são do dono/,
    )
    expectDeny(
      await judge('gh issue reopen 5', {
        repo: { ...elsewhere, repoKnown: false },
      }),
    )
  })

  it('follows GH_REPO the command inherits', async () => {
    expectPass(
      await judge('gh issue reopen 5', {
        extra: { env: { GH_REPO: 'alguem/outro' } },
      }),
    )
    expectDeny(
      await judge(`gh issue comment 5 -b '# Owner Approve'`, {
        repo: null,
        extra: { env: { GH_REPO: PROJECT } },
      }),
      opening,
    )
    expectPass(
      await judge('GH_REPO=alguem/outro gh issue reopen 5', {
        extra: { env: { GH_REPO: PROJECT } },
      }),
    )
  })

  it('asks when an earlier command moved HEAD and the branch decides', async () => {
    const moved = { ...project(), branch: null, branchKnown: false }
    expectAsk(
      await judge(`gh pr create --body 'Closes #5.'`, { repo: moved }),
      {
        critical: true,
        reason: /não consegui ler a branch da PR/,
      },
    )
    expectPass(
      await judge(`gh pr create -H ${BRANCH} --body 'Closes #5.'`, {
        repo: moved,
      }),
    )
    const github = stub()
    expectAsk(await judge('gh pr merge --squash', { repo: moved, github }), {
      critical: true,
      reason: /a branch em que ele roda não pôde ser lida/,
    })
    expect(github.calls).toEqual([])
    expectAsk(await judge(`gh pr edit --body 'Closes #5.'`, { repo: moved }), {
      critical: true,
      reason: /não consegui saber a branch da PR/,
    })
    expectPass(await judge(`gh pr edit 7 --body 'Closes #5.'`, { repo: moved }))
  })

  it('reads a body file as an earlier command of the line left it', async () => {
    const files = (file: string) =>
      path.basename(file) === 'b.md'
        ? { known: true, text: '# Owner Approve\n\nok\n' }
        : undefined
    expectDeny(
      await judge('gh issue comment 5 --body-file b.md', { extra: { files } }),
      opening,
    )
    expectDeny(
      await judge('gh issue comment 5 -F - < b.md', { extra: { files } }),
      opening,
    )
    expectDeny(
      await judge(`gh api repos/${PROJECT}/issues/5/comments -F body=@b.md`, {
        extra: { files },
      }),
      opening,
    )
    const unknownFile = () => ({ known: false, text: null })
    expectAsk(
      await judge('gh issue comment 5 --body-file b.md', {
        extra: { files: unknownFile },
      }),
      { critical: true, reason: unreadBody },
    )
  })
})

describe('gh aliases (review of #5)', () => {
  const config = (dir: string, aliases: string) => {
    mkdirSync(path.join(dir, 'gh'), { recursive: true })
    writeFileSync(
      path.join(dir, 'gh', 'config.yml'),
      `version: 1\n# Aliases\naliases:\n${aliases}\npager:\n`,
    )
    return { XDG_CONFIG_HOME: dir }
  }
  const aliases = [
    '    co: pr checkout',
    '    i: issue',
    '    k: |',
    '        pr merge --auto',
    '    e: |',
    '        issue edit',
    `    q: '!gh issue edit "$1" --add-label ready-for-agent'`,
    '    r: issue edit $1 --add-label ready-for-agent',
    '    v: "issue view"',
    `    g: '!git push origin HEAD:main'`,
  ].join('\n')

  test.for([
    [
      'an alias of a group',
      'gh i edit 5 --add-label ready-for-agent',
      /o alias i do gh é "issue": .*ready-for-agent são do dono/,
    ],
    [
      'a block alias',
      'gh k 7',
      /o alias k do gh é "pr merge --auto": o merge automático/,
    ],
    [
      'a block alias given arguments',
      'gh e 5 --add-label ready-for-agent',
      /o alias e do gh é "issue edit": .*ready-for-agent são do dono/,
    ],
    ['a shell alias', 'gh q 5', /o alias q do gh é "!gh issue edit/],
    ['an alias that takes $1', 'gh r 5', /ready-for-agent são do dono/],
  ] as const)(
    'denies %s from gh’s config',
    async ([, text, reason], { scratch }) => {
      const env = config(scratch(), aliases)
      expectDeny(await judge(text, { extra: { env } }), reason)
    },
  )

  test('passes an alias of a harmless command, and a word that is no alias', async ({
    scratch,
  }) => {
    const env = config(scratch(), aliases)
    expectPass(await judge('gh v 5', { extra: { env } }))
    expectPass(await judge('gh extensao-qualquer x', { extra: { env } }))
    expectPass(await judge('gh co 7', { extra: { env } }))
    expectPass(await judge('gh co 7', { extra: { env: {} } }))
  })

  test('asks for a shell alias that runs git, unless guard-bash judges it', async ({
    scratch,
  }) => {
    const env = config(scratch(), aliases)
    expectAsk(await judge('gh g', { extra: { env } }), {
      critical: true,
      reason: /o alias g do gh roda git/,
    })
    const judged: unknown[] = []
    expectDeny(
      await judge('gh g', {
        extra: {
          env,
          judgeOther: async (command) => {
            judged.push((command as { argv: string[] }).argv)
            return io.deny('negado pelo guard-bash')
          },
        },
      }),
      /o alias g do gh é .*negado pelo guard-bash/,
    )
    expect(judged).toEqual([['git', 'push', 'origin', 'HEAD:main']])
  })

  test('asks when gh’s config cannot be read', async ({ scratch }) => {
    const env = config(scratch(), '    x: [issue]\n  torto')
    expectAsk(await judge('gh x edit 5', { extra: { env } }), {
      critical: true,
      reason: /não consegui ler os aliases do gh/,
    })
    expectPass(await judge('gh issue view 5', { extra: { env } }))
  })

  it('reads an alias an earlier command of the line set, before the config', async () => {
    const ghAliases = new Map([
      ['j', { known: true, text: 'issue' }],
      ['i', null],
      ['u', { known: false, text: null }],
    ])
    expectDeny(
      await judge('gh j edit 5 --add-label ready-for-agent', {
        extra: { ghAliases },
      }),
    )
    expectPass(
      await judge('gh i edit 5 --add-label ready-for-agent', {
        extra: { ghAliases },
      }),
    )
    expectAsk(await judge('gh u 5', { extra: { ghAliases } }), {
      critical: true,
      reason: /não consegui ler o alias u do gh/,
    })
  })

  it('judges gh alias set - from its stdin', async () => {
    expectDeny(
      await judge("gh alias set k - <<'EOF'\npr merge --admin\nEOF"),
      /o alias k faria o que o hook confere/,
    )
    expectPass(await judge("gh alias set v - <<'EOF'\nissue view\nEOF"))
    // An expansion it cannot read (a pipe) asks, critical: it may be one
    // the rule refuses (Copilot review of #26, third round).
    expectAsk(await judge('cat x | gh alias set k -'), {
      critical: true,
      reason: /não consegui ler o que o alias k do gh roda/,
    })
  })

  test('judges each alias gh alias import brings', async ({ scratch }) => {
    const dir = scratch()
    writeFileSync(
      path.join(dir, 'ruins.yml'),
      'm: pr merge --admin\nv: issue view\n',
    )
    writeFileSync(path.join(dir, 'boas.yml'), "v: issue view\nl: 'pr list'\n")
    expectDeny(
      await judge('gh alias import ruins.yml', { cwd: dir }),
      /o gh alias import traria aliases .*o alias m do gh é "pr merge --admin"/,
    )
    expectPass(await judge('gh alias import boas.yml', { cwd: dir }))
    expectDeny(
      await judge("gh alias import - <<'EOF'\nr: issue reopen 5\nEOF", {
        cwd: dir,
      }),
      /reabrir uma issue/,
    )
    expectAsk(await judge('gh alias import nao-existe.yml', { cwd: dir }), {
      critical: true,
      reason: /não consegui ler os aliases que o gh alias import traz/,
    })
  })

  test('lists what a gh alias command defines for the rest of the line', async ({
    scratch,
  }) => {
    const dir = scratch()
    writeFileSync(path.join(dir, 'a.yml'), 'x: issue\n')
    const defined = (text: string) =>
      gh.ghAliasDefinitions(shell.parseCommand(text).commands[0], { cwd: dir })
    expect(defined('gh alias set i issue')).toEqual([
      ['i', { known: true, text: 'issue' }],
    ])
    expect(defined("gh alias set --shell s 'gh issue view'")).toEqual([
      ['s', { known: true, text: '!gh issue view' }],
    ])
    expect(defined("gh alias set k - <<'EOF'\npr merge\nEOF")).toEqual([
      ['k', { known: true, text: 'pr merge\n' }],
    ])
    expect(defined('gh alias set i "$E"')).toEqual([
      ['i', { known: false, text: null }],
    ])
    expect(defined('gh alias import a.yml')).toEqual([
      ['x', { known: true, text: 'issue' }],
    ])
    expect(defined('gh alias delete i')).toEqual([['i', null]])
    expect(defined('gh alias set "$N" issue')).toEqual([])
    expect(defined('gh alias list')).toEqual([])
    expect(defined('gh issue view 5')).toEqual([])
  })

  test('tells which gh commands check another branch out', async ({
    scratch,
  }) => {
    const env = config(scratch(), aliases)
    const moves = (text: string, extra: Partial<GhCtx> = {}) =>
      gh.ghMovesHead(shell.parseCommand(text).commands[0], {
        cwd: tmpdir(),
        env,
        ...extra,
      })
    expect(moves('gh pr checkout 7')).toBe(true)
    expect(moves('gh co 7')).toBe(true)
    expect(moves('gh g')).toBe(true)
    expect(moves('gh pr "$V" 7')).toBe(true)
    expect(
      moves('gh x 7', {
        ghAliases: new Map([['x', { known: true, text: 'pr checkout' }]]),
      }),
    ).toBe(true)
    expect(moves('gh pr view 7')).toBe(false)
    expect(moves('gh i view 5')).toBe(false)
    expect(moves('gh issue view 5')).toBe(false)
  })
})

describe('a repository it cannot read is never this project for a pass (Copilot review of #26)', () => {
  const transition = '--remove-label needs-triage --add-label ready-for-human'
  const unplaced = /não consegui ler em que repositório o comando troca/

  it.each([
    ['-R of a variable', `gh issue edit 5 -R "$REPO" ${transition}`],
    ['--repo= of a variable', `gh issue edit 5 "--repo=$REPO" ${transition}`],
    ['GH_REPO of a variable', `GH_REPO=$DESTINO gh issue edit 5 ${transition}`],
  ])(
    'asks, critical, before reading an issue named through %s',
    async (_, text) => {
      const github = stub({ issueState: issueAnswer() })
      expectAsk(await judge(text, { github }), {
        critical: true,
        reason: unplaced,
      })
      expect(github.calls).toEqual([])
    },
  )

  it('asks the same after a directory or a remote it could not read', async () => {
    const github = stub({ issueState: issueAnswer() })
    expectAsk(
      await judge(`gh issue edit 5 ${transition}`, {
        github,
        extra: { cwdKnown: false },
      }),
      { critical: true, reason: unplaced },
    )
    expectAsk(
      await judge(`gh issue edit 5 ${transition}`, {
        github,
        repo: { ...project(), remoteKnown: false },
      }),
      { critical: true, reason: unplaced },
    )
    expect(github.calls).toEqual([])
  })

  it('keeps the denies that do not depend on the repository', async () => {
    const github = stub()
    expectDeny(
      await judge('gh issue edit 5 -R "$REPO" --add-label ready-for-agent', {
        github,
      }),
      /ready-for-agent são do dono/,
    )
    expectDeny(await judge('gh issue reopen 5 -R "$REPO"', { github }))
    expect(github.calls).toEqual([])
  })

  it('asks, critical, before reading a PR in a repository it cannot read', async () => {
    const github = stub({
      prMergeState: mergeAnswer({ checksOk: false, checksDetail: 'vermelho' }),
    })
    expectAsk(await judge('gh pr merge 7 -R "$REPO" --squash', { github }), {
      critical: true,
      reason: /o repositório da PR não pôde ser lido/,
    })
    expect(github.calls).toEqual([])
  })

  it('judges a remote changed to one it can read by that repository', async () => {
    expectPass(
      await judge('gh issue reopen 5', {
        repo: { ...project(), repo: 'alguem/outro' },
      }),
    )
    expectDeny(
      await judge('gh issue reopen 5', {
        repo: { ...project(), repo: null, remoteKnown: false },
      }),
    )
    expectDeny(
      await judge(
        `gh api repos/{owner}/{repo}/issues/5/labels -f 'labels[]=ready-for-agent'`,
        { repo: { ...project(), repo: 'alguem/outro', remoteKnown: false } },
      ),
      /label de estado/,
    )
  })
})

describe('a PR created through the API (Copilot review of #26)', () => {
  const repoPath = `repos/${PROJECT}`
  const noBody =
    /a PR precisa de um corpo cuja primeira linha é exatamente "Closes #5\."/
  const unreadPrBody = /não consegui ler o corpo da PR/

  it.each([
    [
      'POST by its fields',
      `gh api ${repoPath}/pulls -f head=${BRANCH} -f base=main -f title=T`,
    ],
    [
      '-X POST with placeholders',
      `gh api -X POST repos/{owner}/{repo}/pulls -f head=${BRANCH} -f base=main -f title=T`,
    ],
    [
      'an issue turned into a PR',
      `gh api ${repoPath}/pulls -f head=${BRANCH} -f base=main -F issue=5`,
    ],
  ])('denies a REST %s with no body, as gh pr create does', async (_, text) => {
    expectDeny(await judge(text), noBody)
  })

  test('reads the body from --input, and asks only when it cannot read it', async ({
    scratch,
  }) => {
    const dir = scratch()
    const pr = { head: BRANCH, base: 'main', title: 'T' }
    writeFileSync(path.join(dir, 'sem-corpo.json'), JSON.stringify(pr))
    writeFileSync(
      path.join(dir, 'com-corpo.json'),
      JSON.stringify({ ...pr, body: 'Closes #5.\n\nTexto.' }),
    )
    expectDeny(
      await judge(`gh api ${repoPath}/pulls --input sem-corpo.json`, {
        cwd: dir,
      }),
      noBody,
    )
    expectPass(
      await judge(`gh api ${repoPath}/pulls --input com-corpo.json`, {
        cwd: dir,
      }),
    )
    expectAsk(
      await judge(
        `gh api ${repoPath}/pulls -f head=${BRANCH} -f base=main -f body="$CORPO"`,
      ),
      { critical: true, reason: unreadPrBody },
    )
  })

  const create = (fields: string) =>
    `gh api graphql -f query='mutation { createPullRequest(input: {repositoryId: "R_1", baseRefName: "main", ${fields}}) { pullRequest { url } } }'`

  it('denies createPullRequest through GraphQL with no body', async () => {
    expectDeny(
      await judge(create(`headRefName: "${BRANCH}", title: "T"`)),
      noBody,
    )
  })

  it('holds createPullRequest to the rest of the gh pr create rules', async () => {
    expectDeny(
      await judge(
        create(`headRefName: "claude/x", title: "T", body: "Closes #5."`),
      ),
      /a PR sai de uma branch/,
    )
    expectDeny(
      await judge(
        create(`headRefName: "${BRANCH}", title: "T", body: "Resumo"`),
      ),
      /exatamente "Closes #5\."; hoje é "Resumo"/,
    )
    expectDeny(
      await judge(
        create(`headRefName: "${BRANCH}", title: "T", body: "Closes #7."`),
      ),
      /fecha a #7, mas a branch é da #5/,
    )
    expectDeny(
      await judge(
        create(
          `headRefName: "${BRANCH}", title: "T [skip ci]", body: "Closes #5."`,
        ),
      ),
      /a PR traz "\[skip ci\]"/,
    )
    expectPass(
      await judge(
        create(
          `headRefName: "${BRANCH}", title: "T", body: "Closes #5.\\n\\nTexto."`,
        ),
      ),
    )
  })

  it('reads createPullRequest through variables, and asks for a body it cannot read', async () => {
    const query =
      'mutation($head: String!, $body: String) { createPullRequest(input: {repositoryId: "R_1", baseRefName: "main", headRefName: $head, title: "T", body: $body}) { pullRequest { url } } }'
    expectPass(
      await judge(
        `gh api graphql -f head=${BRANCH} -f body='Closes #5.' -f query='${query}'`,
      ),
    )
    expectAsk(
      await judge(`gh api graphql -f head=${BRANCH} -f query='${query}'`),
      { critical: true, reason: unreadPrBody },
    )
  })
})

// ---------------------------------------------------------------------------
// Third round of Copilot's review of #26

describe('a value it cannot read asks, critical, where the rule would refuse (Copilot review of #26, third round)', () => {
  const repoPath = `repos/${PROJECT}`

  it.each([
    [
      'a label of gh issue create',
      'gh issue create -t T -b corpo -l "$LABEL"',
      /não consegui ler as labels do comando/,
    ],
    [
      'the name of gh label edit',
      'gh label edit "$LABEL" --color fff',
      /não consegui ler as labels do comando/,
    ],
    [
      'an added label of gh issue edit',
      'gh issue edit 5 --add-label "$LABEL"',
      /não consegui ler as labels do comando/,
    ],
    [
      'the file gh issue create --recover restores',
      'gh issue create --recover rascunho.json',
      /--recover traz corpo e labels/,
    ],
    [
      'the title of gh pr create',
      `gh pr create --title "$TITLE" --body 'Closes #5.'`,
      /não consegui ler o título da PR/,
    ],
    [
      'the title of gh pr edit',
      'gh pr edit 7 -t "$TITLE"',
      /não consegui ler o título da PR/,
    ],
    [
      'the --input of the labels endpoint',
      `gh api ${repoPath}/issues/5/labels --input "$BODY"`,
      /não consegui ler as labels do comando/,
    ],
    [
      'the --input of a REST issue edit',
      `gh api -X PATCH ${repoPath}/issues/5 --input "$BODY"`,
      /não consegui ler o que o gh api muda na issue/,
    ],
    [
      'the state of a REST issue edit',
      `gh api -X PATCH ${repoPath}/issues/5 -f state="$STATE"`,
      /não consegui ler o estado que o gh api põe na issue/,
    ],
    [
      'the labels of a REST issue create',
      `gh api ${repoPath}/issues -f title=T -f body=corpo -f 'labels[]'="$LABEL"`,
      /não consegui ler as labels do comando/,
    ],
    [
      'the name of a REST label create',
      `gh api ${repoPath}/labels -f name="$LABEL" -f color=fff`,
      /não consegui ler as labels do comando/,
    ],
    [
      'the title of a REST pull request',
      `gh api ${repoPath}/pulls -f head=feature/5-x -f base=main -f title="$TITLE" -f 'body=Closes #5.'`,
      /não consegui ler o título da PR/,
    ],
    [
      'the title of a REST pull request edit',
      `gh api -X PATCH ${repoPath}/pulls/7 -f title="$TITLE"`,
      /não consegui ler o título da PR/,
    ],
    [
      'a GraphQL state sent by no variable',
      `gh api graphql -f query='mutation($s: IssueState!) { updateIssue(input: {id: "I_1", state: $s}) { issue { id } } }'`,
      /não consegui ler o estado que a mutation põe na issue/,
    ],
    [
      'a GraphQL state behind an expansion',
      `gh api graphql -f s="$STATE" -f query='mutation($s: IssueState!) { updateIssue(input: {id: "I_1", state: $s}) { issue { id } } }'`,
      /não consegui ler o estado que a mutation põe na issue/,
    ],
    [
      'a GraphQL title of updatePullRequest',
      `gh api graphql -f t="$TITLE" -f query='mutation($t: String!) { updatePullRequest(input: {pullRequestId: "PR_1", title: $t}) { pullRequest { id } } }'`,
      /não consegui ler o título da PR/,
    ],
    ['a comment body', 'gh issue comment 5 --body "$BODY"', unreadBody],
    [
      'the thread resolveReviewThread resolves',
      `gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id } } }'`,
      /não consegui ler a thread que o resolveReviewThread resolve/,
    ],
    [
      'the expansion of an alias being set',
      'gh alias set x "$EXPANSAO"',
      /não consegui ler o que o alias x do gh roda/,
    ],
    [
      'the body of gh pr edit',
      'gh pr edit 7 --body "$BODY"',
      /não consegui ler o novo corpo da PR/,
    ],
    [
      'the body of a REST pull request edit',
      `gh api -X PATCH ${repoPath}/pulls/7 -f body="$BODY"`,
      /não consegui ler o novo corpo da PR/,
    ],
    [
      'a GraphQL call from an --input it cannot read',
      'gh api graphql --input "$F"',
      /não consegui ler a chamada GraphQL do gh api/,
    ],
    [
      'the file gh pr create --recover restores, next to a readable body',
      `gh pr create --recover f --title T --body 'Closes #5.'`,
      /gh pr create --recover traz título e corpo/,
    ],
    [
      'an earlier --body of gh pr create, which gh drops',
      `gh pr create --title T --body "$X" --body 'Closes #5.'`,
      /não consegui ler o corpo da PR para conferir que não traz/,
    ],
    [
      'the aliases gh alias import reads from a pipe',
      'cat x | gh alias import',
      /não consegui ler os aliases que o gh alias import traz/,
    ],
    [
      'an alias gh alias import brings and it cannot read',
      "gh alias import - <<'EOF'\nm: [pr, merge]\nEOF",
      /não consegui ler o alias m que o gh alias import traz/,
    ],
  ])('asks, critical, for %s', async (_, text, reason) => {
    const github = stub()
    expectAsk(await judge(text, { github }), { critical: true, reason })
    expect(github.calls).toEqual([])
  })

  it('asks, critical, for a merge subject or body it cannot read, next to the live read', async () => {
    const github = stub({ prMergeState: mergeAnswer() })
    const decision = await judge(
      'gh pr merge 7 --squash --subject "$SUBJECT"',
      {
        github,
      },
    )
    expectAsk(decision, {
      critical: true,
      reason: /não consegui ler o assunto do merge/,
    })
    expect(decision.reason).toMatch(/confira antes do merge/)
    const red = stub({
      prMergeState: mergeAnswer({ checksOk: false, checksDetail: 'vermelho' }),
    })
    expectDeny(
      await judge('gh pr merge 7 --squash --body "$BODY"', { github: red }),
      /não está pronto/,
    )
  })

  it('names the merge body it cannot read, next to the live read', async () => {
    const github = stub({ prMergeState: mergeAnswer() })
    expectAsk(
      await judge('gh pr merge 7 --squash --body "$BODY"', { github }),
      { critical: true, reason: /não consegui ler o corpo do merge/ },
    )
  })

  describe('a gh api field whose key it cannot read', () => {
    it.each([
      [
        'a REST issue edit',
        `gh api -X PATCH ${repoPath}/issues/5 -f "$F"`,
        /não consegui ler o que o gh api muda na issue/,
      ],
      [
        'a REST issue edit, the key behind an expansion',
        `gh api -X PATCH ${repoPath}/issues/5 -f "$K"=open`,
        /não consegui ler o que o gh api muda na issue/,
      ],
      [
        'the labels endpoint',
        `gh api ${repoPath}/issues/5/labels -F "$K"=x`,
        /não consegui ler as labels do comando/,
      ],
      [
        'a REST issue create',
        `gh api ${repoPath}/issues -f title=T -f body=corpo -f "$K"=x`,
        /não consegui ler as labels do comando/,
      ],
      [
        'a REST label create',
        `gh api ${repoPath}/labels --raw-field "$K"=x`,
        /não consegui ler as labels do comando/,
      ],
      [
        'a REST comment',
        `gh api ${repoPath}/issues/5/comments --field "$K"=x`,
        unreadBody,
      ],
      [
        'a GraphQL call',
        'gh api graphql -f "$Q"',
        /não consegui ler a chamada GraphQL do gh api/,
      ],
    ])(
      'asks, critical, on %s: it may be state or labels (Copilot review of #26, third round)',
      async (_, text, reason) => {
        expectAsk(await judge(text), { critical: true, reason })
      },
    )

    it('leaves alone a route whose body no rule reads, and a field gh refuses', async () => {
      expectPass(await judge(`gh api -X GET ${repoPath}/issues -f "$K"=x`))
      expectPass(
        await judge(`gh api ${repoPath}/pulls/7/comments/9/replies -f "$K"=x`),
      )
      // A readable field with no `=` makes gh stop before any request.
      expectPass(await judge(`gh api -X PATCH ${repoPath}/issues/5 -f state`))
      // With --input, the fields go to the query string, not the body.
      expectDeny(
        await judge(
          `gh api -X PATCH ${repoPath}/issues/5 --input - -f "$K"=x <<'EOF'\n{"state": "open"}\nEOF`,
        ),
        /reabrir uma issue/,
      )
    })
  })

  it('reads gh alias import with no file from its stdin, as gh does (Copilot review of #26, third round)', async () => {
    expectDeny(
      await judge("gh alias import <<'EOF'\nr: issue reopen 5\nEOF"),
      /reabrir uma issue/,
    )
    expectPass(await judge("gh alias import <<'EOF'\nv: issue view\nEOF"))
    expect(
      gh.ghAliasDefinitions(
        shell.parseCommand("gh alias import <<'EOF'\nx: issue\nEOF")
          .commands[0],
        { cwd: tmpdir() },
      ),
    ).toEqual([['x', { known: true, text: 'issue' }]])
  })

  it('asks, critical, for an alias it cannot follow to its end', async () => {
    const chain = new Map(
      Array.from({ length: 7 }, (_, k) => [
        `a${k}`,
        { known: true, text: `a${k + 1}` },
      ]),
    )
    chain.set('a7', { known: true, text: 'issue view' })
    expectAsk(await judge('gh a0 5', { extra: { ghAliases: chain } }), {
      critical: true,
      reason: /leva a aliases demais/,
    })
    const ghAliases = new Map([
      ['t', { known: true, text: 'issue comment 5 --body "sem fim' }],
      ['p', { known: true, text: '!$CMD issue list' }],
    ])
    expectAsk(await judge('gh t', { extra: { ghAliases } }), {
      critical: true,
      reason: /não consegui ler o alias t do gh \("/,
    })
    expectAsk(await judge('gh p', { extra: { ghAliases } }), {
      critical: true,
      reason: /roda um programa que o hook não consegue ler/,
    })
  })

  it('asks, critical, when the live read of the label transition fails', async () => {
    const github = stub({ issueState: failure() })
    expectAsk(
      await judge(
        'gh issue edit 5 --remove-label needs-triage --add-label ready-for-human',
        { github },
      ),
      { critical: true, reason: /não consegui confirmar que a issue está em/ },
    )
  })

  it('asks, critical, for the transition in a repository it cannot read', async () => {
    const github = stub({ issueState: issueAnswer() })
    expectAsk(
      await judge(
        'gh issue edit 5 -R "$REPO" --remove-label needs-triage --add-label ready-for-human',
        { github },
      ),
      {
        critical: true,
        reason: /não consegui ler em que repositório o comando troca/,
      },
    )
    expect(github.calls).toEqual([])
  })

  it('asks, critical, for a title --fill takes from the commits', async () => {
    expectAsk(await judge(`gh pr create --fill --body 'Closes #5.'`), {
      critical: true,
      reason: /--fill sem --title/,
    })
    expectPass(
      await judge(`gh pr create --fill --title Hooks --body 'Closes #5.'`),
    )
  })

  it('keeps a plain ask where the rule itself only asks', async () => {
    expectAsk(await judge('gh issue edit 5 --body "Novo corpo, legível."'), {
      reason: /editar o corpo da issue depois do Approve o revoga/,
    })
    expectAsk(await judge('gh issue comment 5 --edit-last -b "Recado."'), {
      reason: /editar um comentário depois do Approve o revoga/,
    })
    expectAsk(await judge(`gh api -X DELETE ${repoPath}/issues/comments/9`), {
      reason: /apagar um comentário depois do Approve o revoga/,
    })
  })

  describe('the forms a session writes stay readable, and pass', () => {
    it('reads a body in "$(cat <<\'EOF\' … EOF)"', async () => {
      expectPass(
        await judge(
          `gh pr create --title "Hooks do loop" --body "$(cat <<'EOF'\nCloses #5.\n\nO resto.\nEOF\n)"`,
        ),
      )
      expectPass(
        await judge(
          `gh issue comment 5 --body "$(cat <<'EOF'\nRecado com $5 e \`crases\`.\nEOF\n)"`,
        ),
      )
      expectDeny(
        await judge(
          `gh issue comment 5 --body "$(cat <<'EOF'\n# Owner Approve\nEOF\n)"`,
        ),
        opening,
      )
      expectDeny(
        await judge(
          `gh pr create --title "Hooks" --body "$(cat <<'EOF'\nCloses #5.\n\n[skip ci]\nEOF\n)"`,
        ),
        /skip ci/,
      )
    })

    test('reads a title and a body file the line assigned', async ({
      scratch,
    }) => {
      const dir = scratch()
      writeFileSync(path.join(dir, 'pr.md'), 'Closes #5.\n\nTexto.\n')
      expectPass(
        await judge(
          `T='Hooks do loop'; P=${dir}/pr.md; gh pr create --title "$T" --body-file "$P"`,
        ),
      )
      expectPass(await judge(`gh pr create --title T --body-file ${dir}/pr.md`))
      expectPass(await judge(`gh issue comment 5 -F - <<'EOF'\nRecado.\nEOF`))
    })
  })
})

describe('the GitHub host a gh command talks to (Copilot review of #26, third round)', () => {
  const transition = '--remove-label needs-triage --add-label ready-for-human'

  it('passes the transition on another host without reading this project’s issue', async () => {
    const github = stub()
    expectPass(
      await judge(
        `GH_HOST=ghe.example.com GH_REPO=geazioliveira/marketo-sandbox gh issue edit 5 ${transition}`,
        { github },
      ),
    )
    expectPass(
      await judge(
        `GH_HOST=ghe.example.com gh issue edit 5 -R geazioliveira/marketo-sandbox ${transition}`,
        { github },
      ),
    )
    expect(github.calls).toEqual([])
  })

  it('reads GH_HOST inherited from the environment, for -R and for the remotes', async () => {
    const github = stub()
    const env = { GH_HOST: 'ghe.example.com' }
    expectPass(
      await judge(`gh issue edit 5 ${transition}`, { github, extra: { env } }),
    )
    expectPass(await judge('gh issue reopen 5', { github, extra: { env } }))
    expectPass(
      await judge('gh issue reopen 5 -R geazioliveira/marketo-sandbox', {
        github,
        extra: { env },
      }),
    )
    expect(github.calls).toEqual([])
  })

  it('asks, critical, before any live read when GH_HOST cannot be read', async () => {
    const github = stub({ issueState: issueAnswer() })
    expectAsk(
      await judge(`GH_HOST=$HOST gh issue edit 5 ${transition}`, { github }),
      {
        critical: true,
        reason: /não consegui ler em que repositório o comando troca/,
      },
    )
    expectAsk(
      await judge(`gh issue edit 5 ${transition}`, {
        github,
        extra: { env: { GH_HOST: '$(cat /etc/host)' } },
      }),
      { critical: true },
    )
    expect(github.calls).toEqual([])
    expectDeny(await judge('GH_HOST=$HOST gh issue reopen 5', { github }))
  })

  it.each([
    ['-R', `GH_HOST=$HOST gh issue edit 5 -R ${PROJECT} ${transition}`],
    [
      'GH_REPO',
      `GH_HOST=$HOST GH_REPO=${PROJECT} gh issue edit 5 ${transition}`,
    ],
  ])(
    'asks, critical, for a repository named with %s on a host it cannot read: it may be github.com',
    async (_, text) => {
      const github = stub({ issueState: issueAnswer() })
      expectAsk(await judge(text, { github }), {
        critical: true,
        reason: /não consegui ler em que repositório o comando troca/,
      })
      expect(github.calls).toEqual([])
    },
  )

  it('reads github.com however gh spells it, on the command, GH_HOST or -R', async () => {
    const github = stub({ issueState: issueAnswer() })
    expectPass(
      await judge(`GH_HOST=GitHub.com gh issue edit 5 ${transition}`, {
        github,
      }),
    )
    expect(github.calls).toEqual([['issueState', PROJECT, 5]])
    for (const repo of [
      'www.github.com/geazioliveira/marketo-sandbox',
      'https://www.github.com/geazioliveira/marketo-sandbox',
      'github.com/geazioliveira/marketo-sandbox',
      'git@github.com:geazioliveira/marketo-sandbox.git',
    ])
      expectDeny(
        await judge(
          `GH_HOST=ghe.example.com gh issue edit 5 -R ${repo} --add-label ready-for-agent`,
        ),
        /ready-for-agent são do dono/,
      )
    expectDeny(
      await judge(
        `GH_HOST=api.github.com gh api -X PATCH repos/${PROJECT}/issues/5 -f state=open`,
      ),
      /reabrir uma issue/,
    )
  })

  it('passes a repository on another host named with -R HOST/OWNER/REPO', async () => {
    const github = stub()
    expectPass(
      await judge(
        `gh issue edit 5 -R ghe.example.com/geazioliveira/marketo-sandbox ${transition}`,
        { github },
      ),
    )
    expectPass(
      await judge(
        'gh issue reopen 5 --repo https://ghe.example.com/geazioliveira/marketo-sandbox',
        { github },
      ),
    )
    expect(github.calls).toEqual([])
  })
})

describe('the host each live read goes to (Copilot review of #26, fifth round)', () => {
  const transition = '--remove-label needs-triage --add-label ready-for-human'
  const resolve = `-f query='mutation { resolveReviewThread(input: {threadId: "PRRT_1"}) { thread { isResolved } } }'`
  // Claude Code's environment, as guard-bash hands it on: an enterprise host.
  const env = { GH_HOST: 'ghe.example.com' }

  /** A client factory that records the host of each client it hands out. */
  function recorder(github: Stub) {
    const hosts: string[] = []
    return {
      hosts,
      githubFor: (host: string) => {
        hosts.push(host)
        return github
      },
    }
  }

  it.each([
    [
      'the label transition, GH_HOST=github.com on the command',
      `GH_HOST=github.com gh issue edit 5 ${transition}`,
      { issueState: issueAnswer() },
    ],
    [
      'gh pr merge, -R github.com/OWNER/REPO',
      `gh pr merge 7 -R github.com/${PROJECT}`,
      { prMergeState: mergeAnswer() },
    ],
    [
      'gh pr merge, the PR URL',
      `gh pr merge https://github.com/${PROJECT}/pull/7`,
      { prMergeState: mergeAnswer() },
    ],
    [
      'resolveReviewThread, --hostname github.com',
      `gh api graphql --hostname github.com ${resolve}`,
      {
        threadLastAuthor: { ok: true, value: 'geazioliveira' },
        viewer: { ok: true, value: 'geazioliveira' },
      },
    ],
    [
      'resolveReviewThread, GH_HOST=github.com on the command',
      `GH_HOST=github.com gh api graphql ${resolve}`,
      {
        threadLastAuthor: { ok: true, value: 'geazioliveira' },
        viewer: { ok: true, value: 'geazioliveira' },
      },
    ],
  ])(
    'reads %s on github.com, over an inherited enterprise GH_HOST',
    async (_, text, answers) => {
      const github = stub(answers)
      const { hosts, githubFor } = recorder(github)
      await judge(text, { github, extra: { env, githubFor } })
      expect(github.calls.length).toBeGreaterThan(0)
      expect(new Set(hosts)).toEqual(new Set(['github.com']))
    },
  )

  it.each<[string, string, Record<string, string>]>([
    ['--hostname "$H"', `gh api graphql --hostname "$H" ${resolve}`, {}],
    ['GH_HOST=$H on the command', `GH_HOST=$H gh api graphql ${resolve}`, {}],
    [
      'GH_HOST=$(…) inherited',
      `gh api graphql ${resolve}`,
      { GH_HOST: '$(cat /etc/host)' },
    ],
  ])(
    'reads nothing for resolveReviewThread on a host it cannot read (%s), and asks, critical',
    async (_, text, inherited) => {
      const github = stub({
        threadLastAuthor: { ok: true, value: 'geazioliveira' },
        viewer: { ok: true, value: 'geazioliveira' },
      })
      const { githubFor } = recorder(github)
      expectAsk(
        await judge(text, { github, extra: { env: inherited, githubFor } }),
        {
          critical: true,
          reason:
            /não consegui confirmar que a última resposta da thread é sua \(não consegui ler em que GitHub/,
        },
      )
      expect(github.calls).toEqual([])
    },
  )

  it('reads an alias’s merge on the host of the command that runs it, and never for an alias being set', async () => {
    const github = stub({ prMergeState: mergeAnswer() })
    const { hosts, githubFor } = recorder(github)
    const ghAliases = new Map([['mg', { known: true, text: 'pr merge' }]])
    expectAsk(
      await judge(`gh mg 7 -R github.com/${PROJECT}`, {
        github,
        extra: { env, githubFor, ghAliases },
      }),
      { critical: true, reason: /confira antes do merge/ },
    )
    expect(hosts).toEqual(['github.com'])
    expect(github.calls).toEqual([['prMergeState', PROJECT, 7]])
    // Set with no GH_HOST, the alias would merge this project's PR; it is
    // still judged as written.
    const setting = recorder(stub())
    expectAsk(
      await judge(`gh alias set m 'pr merge'`, {
        extra: { githubFor: setting.githubFor },
      }),
      { critical: true },
    )
    expect(setting.hosts).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Sixth round of Copilot's review of #26

describe('gh api parameters on the query string (Copilot review of #26, sixth round)', () => {
  const repoPath = `repos/${PROJECT}`
  const addComment =
    'mutation($body: String!) { addComment(input: {subjectId: "I_1", body: $body}) { clientMutationId } }'
  /** The request bodies the cases send with --input, by file name. */
  const inputs: Record<string, unknown> = {
    'body.json': { title: 'Novo título' },
    'comentario.json': { body: 'Recado.' },
    'labels.json': { labels: ['bug'] },
    'lista.json': ['bug'],
    'label.json': { name: 'area/hooks', color: 'ffffff' },
    'pr.json': {
      head: BRANCH,
      base: 'main',
      title: 'Hooks',
      body: 'Closes #5.\n\nTexto.',
    },
    'pr-edit.json': { title: 'Hooks' },
    'merge.json': { base: BRANCH, head: 'outra' },
    'ref.json': { ref: `refs/heads/${BRANCH}`, sha: HEAD },
    'conteudo.json': { message: 'm', content: 'eA==', branch: BRANCH },
    'addcomment.json': { query: addComment, variables: { body: 'Recado.' } },
    // A mutation whose variable is not in the body: gh sends the fields
    // beside it as the variables.
    'mutacao.json': { query: addComment },
    'consulta.json': { query: 'query { viewer { login } }' },
  }

  /** The decision in each permission mode: auto refuses a critical ask. */
  async function inModes(
    text: string,
    dir: string,
  ): Promise<{ default: Decision; auto: Decision }> {
    const decision = await judge(text, { cwd: dir })
    return {
      default: io.resolve(decision, 'default'),
      auto: io.resolve(decision, 'auto'),
    }
  }

  function writeInputs(dir: string) {
    for (const [name, value] of Object.entries(inputs))
      writeFileSync(path.join(dir, name), JSON.stringify(value))
  }

  const reopen = /reabrir uma issue/
  const onQuery = /query string/

  it.each<[string, string, 'deny' | 'ask', 'deny' | 'ask', RegExp]>([
    [
      'state=open next to --input (the example of the review)',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f state=open`,
      'deny',
      'deny',
      reopen,
    ],
    [
      'a typed state next to --input',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -F state=open`,
      'deny',
      'deny',
      reopen,
    ],
    [
      'a nested key gh flattens to state',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f 'x[state]=open'`,
      'deny',
      'deny',
      reopen,
    ],
    [
      'two nested keys that both become state',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f 'x[state]=open' -f 'y[state]=closed'`,
      'deny',
      'deny',
      reopen,
    ],
    [
      // GitHub may read either value, or both at once: the body is unknown,
      // a critical ask, not an edit of a plain body.
      'two nested keys that both become body, with different values',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f 'x[body]=Um' -f 'y[body]=Dois'`,
      'ask',
      'deny',
      /não consegui ler o corpo/,
    ],
    [
      'labels next to --input on the issue',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f 'labels[]=bug'`,
      'deny',
      'deny',
      /o campo labels troca todas as labels/,
    ],
    [
      'an Approve body next to --input on the issue',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f body='# Owner Approve'`,
      'deny',
      'deny',
      opening,
    ],
    [
      'a plain body next to --input on the issue',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f body=Recado`,
      'ask',
      'ask',
      /editar o corpo da issue depois do Approve o revoga/,
    ],
    [
      'a state it cannot read next to --input',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -F state=@nao-existe.txt`,
      'ask',
      'deny',
      /não consegui ler o estado que o gh api põe na issue/,
    ],
    [
      'a field whose key it cannot read next to --input',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f "$K"=open`,
      'ask',
      'deny',
      /não consegui ler o que o gh api muda na issue/,
    ],
    [
      'state=open on the endpoint itself, with --input',
      `gh api -X PATCH '${repoPath}/issues/5?state=open' --input body.json`,
      'deny',
      'deny',
      reopen,
    ],
    [
      'state=open on the endpoint itself, with fields',
      `gh api -X PATCH '${repoPath}/issues/5?state=open' -f title=Outro`,
      'deny',
      'deny',
      reopen,
    ],
    [
      'a state label next to --input on the labels endpoint',
      `gh api ${repoPath}/issues/5/labels --input labels.json -f 'labels[]=ready-for-agent'`,
      'deny',
      'deny',
      /não escreve label de estado por gh api/,
    ],
    [
      'a state label next to a list --input on the labels endpoint',
      `gh api ${repoPath}/issues/5/labels --input lista.json -f 'labels[]=ready-for-agent'`,
      'deny',
      'deny',
      /não escreve label de estado por gh api/,
    ],
    [
      'an Approve body next to --input on a new comment',
      `gh api ${repoPath}/issues/5/comments --input comentario.json -f body='# Owner Approve'`,
      'deny',
      'deny',
      opening,
    ],
    [
      'a withdrawal next to --input on a comment edit',
      `gh api -X PATCH ${repoPath}/issues/comments/9 --input comentario.json -f body='# Approve retirado'`,
      'deny',
      'deny',
      opening,
    ],
    [
      'ready-for-agent next to --input on a new issue',
      `gh api ${repoPath}/issues --input body.json -f 'labels[]=ready-for-agent'`,
      'deny',
      'deny',
      /ready-for-agent é do dono/,
    ],
    [
      'a state label name next to --input on a new label',
      `gh api ${repoPath}/labels --input label.json -f name=ready-for-agent`,
      'deny',
      'deny',
      /as labels de estado são do contrato do loop/,
    ],
    [
      'a state label new_name next to --input on a label edit',
      `gh api -X PATCH ${repoPath}/labels/bug --input label.json -f new_name=ready-for-agent`,
      'deny',
      'deny',
      /as labels de estado são do contrato do loop/,
    ],
    [
      'a skip string in the title next to --input on a new PR',
      `gh api ${repoPath}/pulls --input pr.json -f title='Hooks [skip ci]'`,
      'deny',
      'deny',
      /a PR traz "\[skip ci\]"/,
    ],
    [
      'a body with no Closes line next to --input on a PR edit',
      `gh api -X PATCH ${repoPath}/pulls/7 --input pr-edit.json -f body=Resumo`,
      'deny',
      'deny',
      /Closes/,
    ],
    [
      'base=main next to --input on a merge',
      `gh api ${repoPath}/merges --input merge.json -f base=main`,
      'deny',
      'deny',
      /merge em main pela API/,
    ],
    [
      'ref=refs/heads/main next to --input on a new ref',
      `gh api ${repoPath}/git/refs --input ref.json -f ref=refs/heads/main`,
      'deny',
      'deny',
      /escrever em main pela API/,
    ],
    [
      'branch=main next to --input on a contents write',
      `gh api -X PUT ${repoPath}/contents/a.md --input conteudo.json -f branch=main`,
      'deny',
      'deny',
      /sem branch cai em main/,
    ],
    [
      'an Approve variable next to a GraphQL --input',
      `gh api graphql --input addcomment.json -f body='# Owner Approve'`,
      'deny',
      'deny',
      opening,
    ],
    [
      // Read with the query string over the body, the query only reads; read
      // with the body over it, the body's mutation takes the Approve from
      // the query string as its variable.
      'an Approve variable next to a GraphQL --input, with a query there that only reads',
      `gh api graphql --input mutacao.json -f query='query { viewer { login } }' -f body='# Owner Approve'`,
      'deny',
      'deny',
      opening,
    ],
    [
      'a mutation query next to a GraphQL --input that only reads',
      `gh api graphql --input consulta.json -f query='mutation { reopenIssue(input: {issueId: "I_1"}) { clientMutationId } }'`,
      'deny',
      'deny',
      reopen,
    ],
  ])(
    'judges %s as a body field, in default and auto',
    async (_, text, inDefault, inAuto, reason) => {
      const dir = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'gh-query-')),
      )
      try {
        writeInputs(dir)
        const { default: normal, auto } = await inModes(text, dir)
        expect(normal.decision).toBe(inDefault)
        expect(auto.decision).toBe(inAuto)
        expect(normal.reason).toMatch(reason)
        expect(normal.reason).toMatch(onQuery)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it.each([
    [
      'a GET, whatever it sends',
      `gh api -X GET ${repoPath}/issues/5 --input body.json -f state=open`,
    ],
    [
      'a route no rule reads',
      `gh api ${repoPath}/milestones --input body.json -f state=open`,
    ],
    [
      'a field the issue rule does not read',
      `gh api -X PATCH ${repoPath}/issues/5 --input body.json -f title=Outro`,
    ],
    [
      'a plain comment body',
      `gh api ${repoPath}/issues/5/comments --input comentario.json -f body=Outro`,
    ],
    [
      'a label that is no state label',
      `gh api ${repoPath}/issues/5/labels --input labels.json -f 'labels[]=enhancement'`,
    ],
    [
      // gh sends them as labels[]=bug&labels[]=enhancement, one list: no
      // repeated key whose value is unknown.
      'two labels that are no state labels',
      `gh api ${repoPath}/issues/5/labels --input labels.json -f 'labels[]=bug' -f 'labels[]=enhancement'`,
    ],
    [
      'a GraphQL query with a variable',
      'gh api graphql --input consulta.json -f login=alguem',
    ],
    [
      'another repository',
      'gh api -X PATCH repos/alguem/outro/issues/5 --input body.json -f state=open',
    ],
    [
      'a read-only query string on the endpoint',
      `gh api '${repoPath}/issues?state=open&per_page=5'`,
    ],
  ])('passes %s, in default and auto', async (_, text) => {
    const dir = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), 'gh-query-')),
    )
    try {
      writeInputs(dir)
      const { default: normal, auto } = await inModes(text, dir)
      expectPass(normal)
      expectPass(auto)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
