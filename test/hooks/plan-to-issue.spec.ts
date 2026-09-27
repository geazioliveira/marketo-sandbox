import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base } from 'vitest'
import {
  agentPlanLabelTransition,
  bugSections,
  featureSections,
  gateCacheFile,
  planPendingFile,
  planPendingPrefix,
} from '../../scripts/loop-sections.mjs'
import {
  type HookRepo,
  hookRepo,
  type HookRepoOptions,
  type HookRun,
  hooksDir,
  runHook,
  processTimeout,
  spawnWith,
} from '../support/hooks'
import { projectRoot } from '../support/temp-repo'
import { cleanEnv } from '../support/clean-env'

/**
 * The plan-to-issue hook (.claude/hooks/plan-to-issue.mjs), PostToolUse on
 * ExitPlanMode and Bash. A plan accepted in plan mode leaves a marker in the
 * worktree's git dir, which keeps the gate closed (gateStatus reads
 * 'pending-plan') until the plan is posted on an issue of this project.
 *
 * The two ways it can go wrong are both holes: a marker never written lets
 * the agent build on a plan the owner never saw, and a marker removed by
 * something that is not a publication does the same one step later. So each
 * removal case has the refusal beside it, and every case runs the hook as a
 * process, the way Claude Code runs it.
 */

const test = base.extend<{
  fresh: (options?: HookRepoOptions) => Promise<HookRepo>
  scratch: () => string
}>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  fresh: async ({}, use) => {
    const made: HookRepo[] = []
    await use(async (options = {}) => {
      const repo = await hookRepo(options)
      made.push(repo)
      return repo
    })
    for (const repo of made) repo.remove()
  },
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  scratch: async ({}, use) => {
    const made: string[] = []
    await use(() => {
      const dir = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'hooks-spec-')),
      )
      made.push(dir)
      return dir
    })
    for (const dir of made) rmSync(dir, { recursive: true, force: true })
  },
})

vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })

const SESSION = 'sessao-plano-1'
const OTHER = 'sessao-outra'
const BRANCH = 'feature/5-hooks-claude-code'
const ISSUE_URL = 'https://github.com/geazioliveira/marketo-sandbox/issues'
const { from: FROM, to: TO } = agentPlanLabelTransition

/** A plan with one `##` section per required heading, some left out. */
function sectionsOf(
  required: readonly { heading: string }[],
  skip: readonly string[] = [],
): string {
  return required
    .filter(({ heading }) => !skip.includes(heading))
    .map(({ heading }) => `## ${heading}\n\nTexto de ${heading}.`)
    .join('\n\n')
}

const planComment = `# Plano\n\n${sectionsOf(featureSections)}\n`

/** The input Claude Code gives a PostToolUse hook after ExitPlanMode. */
function exitPlanMode(
  repo: HookRepo,
  {
    toolInput = {},
    toolResponse = {},
    session = SESSION,
    event = 'PostToolUse',
  }: {
    toolInput?: Record<string, unknown>
    toolResponse?: unknown
    session?: string
    event?: string
  } = {},
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<HookRun> {
  return repo.run(
    'plan-to-issue',
    {
      session_id: session,
      transcript_path: path.join(repo.root, 'transcript.jsonl'),
      cwd: repo.dir,
      permission_mode: 'plan',
      hook_event_name: event,
      tool_name: 'ExitPlanMode',
      tool_input: toolInput,
      tool_response: toolResponse,
    },
    options,
  )
}

/** The input after a Bash call; `stdout` a string becomes { stdout }, anything else goes as it is. */
function bash(
  repo: HookRepo,
  command: string,
  stdout: unknown,
  {
    session = SESSION,
    cwd = repo.dir,
    env,
  }: { session?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<HookRun> {
  return repo.run(
    'plan-to-issue',
    {
      session_id: session,
      transcript_path: path.join(repo.root, 'transcript.jsonl'),
      cwd,
      permission_mode: 'default',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command, description: 'Publicar o plano' },
      tool_response:
        typeof stdout === 'string'
          ? { stdout, stderr: '', interrupted: false, isImage: false }
          : stdout,
    },
    { env },
  )
}

const cacheExists = (repo: HookRepo): boolean =>
  existsSync(path.join(repo.gitDir, gateCacheFile))

const contextOf = (run: HookRun): string =>
  run.json?.hookSpecificOutput?.additionalContext ?? ''

const readMarker = (
  repo: HookRepo,
  session = SESSION,
): Record<string, unknown> =>
  JSON.parse(readFileSync(repo.markerPath(session), 'utf8')) as Record<
    string,
    unknown
  >

/** A repository on the issue's branch with this session's plan pending. */
const pending = (fresh: (options?: HookRepoOptions) => Promise<HookRepo>) =>
  fresh({ branch: BRANCH, cache: true, marker: SESSION })

describe.concurrent('plan-to-issue on ExitPlanMode', () => {
  test('writes the marker from tool_input.plan and planFilePath, and lists the required sections', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const plan = `${planComment}\n${'x'.repeat(400)}`
    const before = Date.now()
    const run = await exitPlanMode(repo, {
      toolInput: { plan, planFilePath: '/home/x/.claude/plans/p.md' },
    })
    expect(run.status).toBe(0)
    expect(run.stderr).toBe('')
    const marker = readMarker(repo)
    expect(marker).toMatchObject({
      schema: 1,
      sessionId: SESSION,
      branch: BRANCH,
      planFilePath: '/home/x/.claude/plans/p.md',
      planHead: plan.slice(0, 300),
    })
    const acceptedAt = Date.parse(String(marker.acceptedAt))
    expect(acceptedAt).toBeGreaterThanOrEqual(before - 1000)
    expect(acceptedAt).toBeLessThanOrEqual(Date.now() + 1000)

    expect(run.json?.hookSpecificOutput?.hookEventName).toBe('PostToolUse')
    const text = contextOf(run)
    expect(text).toContain('não é Approve')
    expect(text).toContain('# Plano')
    expect(text).toContain('na #5, a issue desta branch')
    expect(text).toContain('sozinho no comando')
    expect(text).toContain('rode npm run gate de novo')
    expect(text).toContain(TO)
    expect(text).toContain('context/intent/')
    for (const { heading } of [...featureSections, ...bugSections])
      expect(text).toContain(heading)
    // The hook reads nothing live.
    expect(repo.calls()).toEqual([])
  })

  test('writes the marker from tool_response.plan and filePath when tool_input has neither', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const run = await exitPlanMode(repo, {
      toolResponse: {
        plan: '# Plano da resposta',
        filePath: '/tmp/plano.md',
        isAgent: false,
      },
    })
    expect(run.status).toBe(0)
    expect(readMarker(repo)).toMatchObject({
      sessionId: SESSION,
      branch: BRANCH,
      planFilePath: '/tmp/plano.md',
      planHead: '# Plano da resposta',
    })
    expect(contextOf(run)).toContain('não é Approve')
  })

  test('prefers tool_input over tool_response', async ({ fresh, expect }) => {
    const repo = await fresh({ branch: BRANCH })
    await exitPlanMode(repo, {
      toolInput: { plan: 'do input', planFilePath: '/a.md' },
      toolResponse: { plan: 'da resposta', filePath: '/b.md' },
    })
    expect(readMarker(repo)).toMatchObject({
      planHead: 'do input',
      planFilePath: '/a.md',
    })
  })

  test('writes the marker even when no plan text can be read', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const run = await exitPlanMode(repo, { toolResponse: 'texto solto' })
    expect(run.status).toBe(0)
    expect(readMarker(repo)).toMatchObject({
      planHead: '',
      planFilePath: null,
    })
  })

  test('cuts planHead at 300 characters without splitting one', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const plan = `${'a'.repeat(299)}😀${'b'.repeat(10)}`
    await exitPlanMode(repo, { toolInput: { plan } })
    expect(readMarker(repo).planHead).toBe(`${'a'.repeat(299)}😀`)
  })

  test('writes the marker on main too, with the branch as it is', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh()
    const run = await exitPlanMode(repo, { toolInput: { plan: '# Plano' } })
    expect(readMarker(repo).branch).toBe('main')
    // No issue to name on main: the comment goes on the issue of the work.
    expect(contextOf(run)).toContain('na issue do trabalho')
    expect(contextOf(run)).not.toContain('a issue desta branch')
  })

  test('leaves another session marker untouched', async ({ fresh, expect }) => {
    const repo = await fresh({ branch: BRANCH, marker: OTHER })
    const other = readFileSync(repo.markerPath(OTHER), 'utf8')
    await exitPlanMode(repo, { toolInput: { plan: 'meu plano' } })
    expect(readFileSync(repo.markerPath(OTHER), 'utf8')).toBe(other)
    expect(readMarker(repo).planHead).toBe('meu plano')
  })

  test('does nothing in another repository, or in one with no origin', async ({
    fresh,
    expect,
  }) => {
    for (const origin of ['https://github.com/someone/else.git', null]) {
      const repo = await fresh({ branch: BRANCH, origin })
      const run = await exitPlanMode(repo, { toolInput: { plan: '# Plano' } })
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    }
  })

  test('does nothing outside a repository', async ({ scratch, expect }) => {
    const dir = scratch()
    const run = await runHook(
      'plan-to-issue',
      {
        session_id: SESSION,
        cwd: dir,
        hook_event_name: 'PostToolUse',
        tool_name: 'ExitPlanMode',
        tool_input: { plan: '# Plano' },
      },
      { env: cleanEnv(dir) },
    )
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
  })

  test('writes nothing when the event is not PostToolUse', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const run = await exitPlanMode(repo, {
      toolInput: { plan: '# Plano' },
      event: 'PreToolUse',
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
  })

  test('says so, and exits 0, when git cannot run to find the git dir', async ({
    fresh,
    scratch,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const run = await exitPlanMode(
      repo,
      { toolInput: { plan: '# Plano' } },
      { env: { ...repo.env(), PATH: scratch() } },
    )
    expect(run.status).toBe(0)
    expect(contextOf(run)).toContain('o hook plan-to-issue falhou')
    expect(contextOf(run)).toContain('Publique o plano numa issue')
  })
})

describe.concurrent('plan-to-issue on Bash: what removes the marker', () => {
  test('gh issue comment N --body-file f, opening with # Plano, with the issue URL in stdout', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    const url = `${ISSUE_URL}/5#issuecomment-3301`
    const run = await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${url}\n`,
    )
    expect(run.status).toBe(0)
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    expect(run.json?.hookSpecificOutput?.hookEventName).toBe('PostToolUse')
    expect(contextOf(run)).toBe(
      [
        `plano publicado em ${url}; o marcador foi removido. Se a issue estava em ${FROM}, troque: gh issue edit 5 --remove-label ${FROM} --add-label ${TO}`,
        'Rode npm run gate de novo antes de construir: o cache do gate de cada worktree deste repositório, se havia um, foi removido, porque veio de antes deste plano, que ainda não tem o Approve do dono.',
      ].join('\n'),
    )
    expect(repo.calls()).toEqual([])
  })

  test('publishing the plan removes the gate cache of every worktree, so the gate runs again before any build', async ({
    fresh,
    expect,
  }) => {
    // The cache was written before this plan: the Approve it read is the
    // one the new # Plano cancels. Left in place, it would read as open for
    // up to gateTtlHours on a plan the owner never saw. The marker lives in
    // the common git dir, seen from every worktree, so removing it opens
    // them all: each worktree's cache goes with it (Copilot review of #26).
    const repo = await pending(fresh)
    const other = await repo.addWorktree('outra', 'feature/8-outra')
    const third = await repo.addWorktree('terceira', 'feature/9-terceira')
    writeFileSync(path.join(other.gitDir, gateCacheFile), '{}\n')
    writeFileSync(path.join(third.gitDir, gateCacheFile), '{}\n')
    expect(cacheExists(repo)).toBe(true)
    repo.write({ 'plano.md': planComment })
    const run = await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-3302\n`,
    )
    expect(run.status).toBe(0)
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    expect(cacheExists(repo)).toBe(false)
    expect(existsSync(path.join(other.gitDir, gateCacheFile))).toBe(false)
    expect(existsSync(path.join(third.gitDir, gateCacheFile))).toBe(false)
    expect(contextOf(run)).toContain('Rode npm run gate de novo')
    expect(contextOf(run)).toContain('de cada worktree deste repositório')
  })

  test('a gate cache that cannot be removed keeps the marker, and it says so (Copilot review of #26)', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    const other = await repo.addWorktree('outra', 'feature/8-outra')
    // A directory where the cache goes: rm refuses it without recursion.
    mkdirSync(path.join(other.gitDir, gateCacheFile, 'dentro'), {
      recursive: true,
    })
    repo.write({ 'plano.md': planComment })
    const run = await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-3304\n`,
    )
    expect(run.status).toBe(0)
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
    expect(contextOf(run)).toContain('o hook plan-to-issue falhou')
  })

  test('a publication with no cache in the worktree still says to run the gate', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH, marker: SESSION })
    repo.write({ 'plano.md': planComment })
    const run = await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-3303\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    expect(cacheExists(repo)).toBe(false)
    expect(contextOf(run)).toContain('Rode npm run gate de novo')
  })

  test('the same with the body in a heredoc (--body-file -)', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    const run = await bash(
      repo,
      `gh issue comment 5 --body-file - <<'EOF'\n${planComment}EOF`,
      `${ISSUE_URL}/5#issuecomment-1\n`,
    )
    expect(run.status).toBe(0)
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    expect(contextOf(run)).toContain('o marcador foi removido')
  })

  test('the same with an inline --body and the issue named by its URL', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    const run = await bash(
      repo,
      `gh issue comment ${ISSUE_URL}/5 --body '${planComment}'`,
      `${ISSUE_URL}/5#issuecomment-2\n`,
    )
    expect(run.status).toBe(0)
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
  })

  test('a tool response that is a plain string holding the URL', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    const run = await repo.run('plan-to-issue', {
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'gh issue comment 5 -F plano.md' },
      tool_response: `${ISSUE_URL}/5#issuecomment-9`,
    })
    expect(run.status).toBe(0)
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
  })

  test('gh issue create with a complete plan and the enhancement label', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'issue.md': sectionsOf(featureSections) })
    const run = await bash(
      repo,
      `gh issue create --title 'Uma coisa' --label enhancement,${TO} --body-file issue.md`,
      `Creating issue in geazioliveira/marketo-sandbox\n\n${ISSUE_URL}/19\n`,
    )
    expect(run.status).toBe(0)
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    expect(contextOf(run)).toContain(`plano publicado em ${ISSUE_URL}/19;`)
    expect(contextOf(run)).toContain(`gh issue edit 19 --remove-label ${FROM}`)
  })

  test('gh issue create with a complete bug plan and -l bug', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    const run = await bash(
      repo,
      `gh issue create -t Falha -l bug -l ${TO} -F - <<'EOF'\n${sectionsOf(bugSections)}\nEOF`,
      `${ISSUE_URL}/20\n`,
    )
    expect(run.status).toBe(0)
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
  })

  test('gh issue create with no category label tries both kinds', async ({
    fresh,
    expect,
  }) => {
    for (const sections of [featureSections, bugSections]) {
      const repo = await pending(fresh)
      repo.write({ 'issue.md': sectionsOf(sections) })
      await bash(
        repo,
        `gh issue create -t Coisa -l ${TO} -F issue.md`,
        `${ISSUE_URL}/21\n`,
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    }
  })

  test('gh issue new, the alias, counts too', async ({ fresh, expect }) => {
    const repo = await pending(fresh)
    repo.write({ 'issue.md': sectionsOf(featureSections) })
    await bash(
      repo,
      'gh issue new -t Coisa -l enhancement -F issue.md',
      `${ISSUE_URL}/22\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
  })

  test('a publication run from a subdirectory of the project, after cd', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    mkdirSync(path.join(repo.dir, 'docs'))
    repo.write({ 'docs/plano.md': planComment })
    await bash(
      repo,
      'cd docs && gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-4\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
  })

  test('-R naming the project in another case counts', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    await bash(
      repo,
      'gh issue comment 5 -R GeazioLiveira/Marketo-Sandbox --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-5\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
  })

  test('only this session marker is removed', async ({ fresh, expect }) => {
    const repo = await pending(fresh)
    repo.writeMarker(OTHER)
    repo.write({ 'plano.md': planComment })
    await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-6\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    expect(existsSync(repo.markerPath(OTHER))).toBe(true)
  })
})

describe.concurrent('plan-to-issue on Bash: what keeps the marker', () => {
  test('a publication whose output shows no issue URL, and it says so', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    for (const stdout of ['', 'algo deu errado\n', `${ISSUE_URL}s/5\n`]) {
      const run = await bash(
        repo,
        'gh issue comment 5 --body-file plano.md',
        stdout,
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain('não mostra a URL da issue')
      expect(contextOf(run)).toContain('o marcador continua')
    }
  })

  test('a tool response with no stdout at all', async ({ fresh, expect }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    for (const response of [null, {}, { stdout: 42 }, ['x']]) {
      const run = await bash(
        repo,
        'gh issue comment 5 --body-file plano.md',
        response,
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain('não mostra a URL da issue')
    }
  })

  test('a comment whose URL names another issue than the one commented on', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    const run = await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/6#issuecomment-1\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
    expect(contextOf(run)).toContain('o marcador continua')
  })

  test('a comment on a pull request, whose URL is no issue', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      'https://github.com/geazioliveira/marketo-sandbox/pull/5#issuecomment-1\n',
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
  })

  test('a body that does not open with exactly # Plano, and it stays quiet', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    for (const body of [
      'Obrigado pela revisão.',
      `# Plano de testes\n\n${sectionsOf(featureSections)}`,
      `Segue o plano:\n\n${planComment}`,
      '# Owner Approve\n\nPode seguir.',
    ]) {
      repo.write({ 'corpo.md': body })
      const run = await bash(
        repo,
        'gh issue comment 5 --body-file corpo.md',
        `${ISSUE_URL}/5#issuecomment-7\n`,
      )
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
    }
  })

  test('a body it cannot read, and it says so', async ({ fresh, expect }) => {
    const repo = await pending(fresh)
    for (const command of [
      'gh issue comment 5 --body "$PLANO"',
      'gh issue comment 5 --body-file ausente.md',
      'gh issue comment 5 --editor',
      'cat plano.md | gh issue comment 5 --body-file -',
    ]) {
      const run = await bash(repo, command, `${ISSUE_URL}/5#issuecomment-8\n`)
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain('não consegui ler o corpo')
    }
  })

  test('gh issue create with a required section missing names it', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'issue.md': sectionsOf(featureSections, ['Riscos']) })
    const run = await bash(
      repo,
      'gh issue create -t Coisa -l enhancement -F issue.md',
      `${ISSUE_URL}/23\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
    expect(contextOf(run)).toContain('faltam Riscos')
    expect(contextOf(run)).toContain('o marcador continua')
  })

  test('gh issue create with a feature plan under the bug label', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'issue.md': sectionsOf(featureSections) })
    await bash(
      repo,
      'gh issue create -t Coisa -l bug -F issue.md',
      `${ISSUE_URL}/24\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
  })

  test('gh issue create with both category labels', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({
      'issue.md': `${sectionsOf(featureSections)}\n\n${sectionsOf(bugSections)}`,
    })
    const run = await bash(
      repo,
      'gh issue create -t Coisa -l bug,enhancement -F issue.md',
      `${ISSUE_URL}/25\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
    expect(contextOf(run)).toContain('o marcador do plano continua')
  })

  test('a publication to another repository: -R, an issue URL, GH_REPO, or cd into one', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    const elsewhere = await fresh({
      origin: 'https://github.com/someone/else.git',
    })
    repo.write({ 'plano.md': planComment })
    elsewhere.write({ 'plano.md': planComment })
    for (const command of [
      'gh issue comment 5 -R someone/else --body-file plano.md',
      'gh issue comment https://github.com/someone/else/issues/5 --body-file plano.md',
      'GH_REPO=someone/else gh issue comment 5 --body-file plano.md',
      `cd ${JSON.stringify(elsewhere.dir)} && gh issue comment 5 --body-file plano.md`,
    ]) {
      const run = await bash(repo, command, `${ISSUE_URL}/5#issuecomment-10\n`)
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
    }
  })

  test('a target it cannot read keeps the marker, and it says so', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    for (const command of [
      'gh issue comment 5 --repo "$REPO" --body-file plano.md',
      'gh issue comment "$ISSUE" --body-file plano.md',
      'GH_REPO=$DESTINO gh issue comment 5 --body-file plano.md',
      'cd "$DIR" && gh issue comment 5 --body-file plano.md',
    ]) {
      const run = await bash(repo, command, `${ISSUE_URL}/5#issuecomment-15\n`)
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain(
        'não consegui ler em que issue, repositório ou host',
      )
    }
  })

  test('another session marker is untouched by this session publication', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH, marker: OTHER })
    const before = readFileSync(repo.markerPath(OTHER), 'utf8')
    repo.write({ 'plano.md': planComment })
    const run = await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-11\n`,
    )
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(readFileSync(repo.markerPath(OTHER), 'utf8')).toBe(before)
  })

  test('a non-project repository does nothing, even with a marker in it', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({
      branch: BRANCH,
      origin: 'https://github.com/someone/else.git',
      marker: SESSION,
    })
    repo.write({ 'plano.md': planComment })
    const run = await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-12\n`,
    )
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
  })

  test('commands that publish nothing: gh issue view, gh pr comment, echo', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    for (const command of [
      'gh issue view 5 --comments',
      'gh pr comment 7 --body-file plano.md',
      'echo "gh issue comment 5 --body-file plano.md"',
      'git log --oneline',
    ]) {
      const run = await bash(repo, command, `${ISSUE_URL}/5#issuecomment-13\n`)
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
    }
  })
})

describe.concurrent(
  'plan-to-issue on Bash: only gh itself, alone on its line, publishes',
  () => {
    test('a URL printed by another command of the line does not count, and it says so', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      for (const command of [
        `false && gh issue comment 5 --body-file plano.md; echo ${ISSUE_URL}/5`,
        `gh issue comment 5 --body-file plano.md || echo ${ISSUE_URL}/5`,
        'gh issue comment 5 --body-file plano.md | tee saida.txt',
        "bash -c 'gh issue comment 5 --body-file plano.md'",
        'gh issue comment 5 --body-file plano.md; gh issue comment 5 --body-file plano.md',
      ]) {
        const run = await bash(repo, command, `${ISSUE_URL}/5\n`)
        expect(run.status).toBe(0)
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
        expect(cacheExists(repo)).toBe(true)
        expect(contextOf(run)).toContain('sozinho no comando')
        expect(contextOf(run)).toContain('o marcador continua')
      }
    })

    test('a line it cannot read whole does not count, and it says so', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      const run = await bash(
        repo,
        'gh issue comment 5 --body-file plano.md "sem fim',
        `${ISSUE_URL}/5#issuecomment-99\n`,
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain('não consegui ler o comando inteiro')
    })

    test('a body file rewritten on the same line does not count', async ({
      fresh,
      expect,
    }) => {
      // The hook reads the file after the line ran: what it reads is not what
      // gh posted when another command of the line wrote the file afterwards.
      const repo = await pending(fresh)
      repo.write({ 'x.md': '# Plano\n' })
      const run = await bash(
        repo,
        "gh issue comment 5 --body-file x.md && printf '# Plano\\n' > x.md",
        `${ISSUE_URL}/5#issuecomment-100\n`,
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain('sozinho no comando')
    })

    test('gh called by a path, or quoted, is not the gh of PATH', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      for (const command of [
        './gh issue comment 5 --body-file plano.md',
        '/tmp/bin/gh issue comment 5 --body-file plano.md',
        "'gh' issue comment 5 --body-file plano.md",
      ]) {
        const run = await bash(
          repo,
          command,
          `${ISSUE_URL}/5#issuecomment-101\n`,
        )
        expect(run.status).toBe(0)
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
        expect(contextOf(run)).toContain('o gh do PATH')
      }
    })

    test('the URL counts only as a whole line of the output, and only this project', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      for (const stdout of [
        `${ISSUE_URL}/5abc\n`,
        `${ISSUE_URL}/5/comments\n`,
        `veja ${ISSUE_URL}/5#issuecomment-1\n`,
        `${ISSUE_URL}/5#issuecomment-1 feito\n`,
        'https://github.com/someone/else/issues/5#issuecomment-1\n',
        'https://github.com/geazioliveira/marketo-sandbox-fork/issues/5\n',
      ]) {
        const run = await bash(
          repo,
          'gh issue comment 5 --body-file plano.md',
          stdout,
        )
        expect(run.status).toBe(0)
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
        expect(contextOf(run)).toContain('não mostra a URL da issue')
      }
    })

    test('env, GH_REPO and a redirection on the gh command itself still count', async ({
      fresh,
      expect,
    }) => {
      for (const command of [
        'GH_REPO=geazioliveira/marketo-sandbox gh issue comment 5 --body-file plano.md',
        'env GH_REPO=geazioliveira/marketo-sandbox gh issue comment 5 --body-file plano.md',
        'gh issue comment 5 --body-file plano.md 2>&1',
      ]) {
        const repo = await pending(fresh)
        repo.write({ 'plano.md': planComment })
        const run = await bash(
          repo,
          command,
          `${ISSUE_URL}/5#issuecomment-102\n`,
        )
        expect(run.status).toBe(0)
        expect(existsSync(repo.markerPath(SESSION))).toBe(false)
        expect(contextOf(run)).toContain('o marcador foi removido')
      }
    })
  },
)

describe.concurrent('plan-to-issue on Bash: the issue the branch names', () => {
  test('on an issue branch, a # Plano comment on another issue keeps the marker, and it says so', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    repo.write({ 'plano.md': planComment })
    for (const [command, stdout] of [
      [
        'gh issue comment 1 --body-file plano.md',
        `${ISSUE_URL}/1#issuecomment-5\n`,
      ],
      [
        `gh issue comment ${ISSUE_URL}/6 --body-file plano.md`,
        `${ISSUE_URL}/6#issuecomment-5\n`,
      ],
    ]) {
      const run = await bash(repo, command, stdout)
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(cacheExists(repo)).toBe(true)
      expect(contextOf(run)).toContain('esta branch é da #5')
      expect(contextOf(run)).toContain('o marcador continua')
    }
  })

  test('on a branch that names no issue, a # Plano comment on any issue of the project counts, #N too', async ({
    fresh,
    expect,
  }) => {
    for (const branch of ['main', 'claude/x']) {
      const repo = await fresh({ branch, marker: SESSION })
      repo.write({ 'plano.md': planComment })
      const run = await bash(
        repo,
        "gh issue comment '#7' --body-file plano.md",
        `${ISSUE_URL}/7#issuecomment-1\n`,
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
      expect(contextOf(run)).toContain('gh issue edit 7 ')
    }
  })

  test('#N names the issue: a URL of another issue does not count', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ marker: SESSION })
    repo.write({ 'plano.md': planComment })
    await bash(
      repo,
      "gh issue comment '#7' --body-file plano.md",
      `${ISSUE_URL}/8#issuecomment-1\n`,
    )
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
  })

  test('a comment whose issue cannot be read as a number keeps the marker', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ marker: SESSION })
    repo.write({ 'plano.md': planComment })
    for (const command of [
      'gh issue comment --body-file plano.md',
      'gh issue comment cinco --body-file plano.md',
      `gh issue comment https://github.com/geazioliveira/marketo-sandbox/pull/7 --body-file plano.md`,
    ]) {
      const run = await bash(repo, command, `${ISSUE_URL}/7#issuecomment-1\n`)
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain(
        'não consegui ler em que issue, repositório ou host',
      )
    }
  })
})

describe.concurrent(
  'plan-to-issue on Bash: the worktree the publication runs in (Copilot review of #26)',
  () => {
    const otherCache = (other: { gitDir: string }) =>
      existsSync(path.join(other.gitDir, gateCacheFile))

    test('a cd into another worktree reads that worktree branch, and clears the caches from there', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      const other = await repo.addWorktree('outra', 'feature/8-outra')
      writeFileSync(path.join(other.gitDir, gateCacheFile), '{}\n')
      repo.write({ 'plano.md': planComment }, other.dir)
      const run = await bash(
        repo,
        `cd ${JSON.stringify(other.dir)} && gh issue comment 8 --body-file plano.md`,
        `${ISSUE_URL}/8#issuecomment-40\n`,
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
      expect(otherCache(other)).toBe(false)
      expect(cacheExists(repo)).toBe(false)
      expect(contextOf(run)).toContain('gh issue edit 8 ')
    })

    test('a cd into another worktree holds a comment to that worktree issue', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      const other = await repo.addWorktree('outra', 'feature/8-outra')
      writeFileSync(path.join(other.gitDir, gateCacheFile), '{}\n')
      repo.write({ 'plano.md': planComment }, other.dir)
      const run = await bash(
        repo,
        `cd ${JSON.stringify(other.dir)} && gh issue comment 5 --body-file plano.md`,
        `${ISSUE_URL}/5#issuecomment-41\n`,
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(otherCache(other)).toBe(true)
      expect(cacheExists(repo)).toBe(true)
      expect(contextOf(run)).toContain('esta branch é da #8')
    })

    test('a session opened above the repository publishes from the worktree it cds into', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      const run = await bash(
        repo,
        'cd repo && gh issue comment 5 --body-file plano.md',
        `${ISSUE_URL}/5#issuecomment-42\n`,
        { cwd: repo.root },
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
      expect(cacheExists(repo)).toBe(false)
    })

    test('a publication run outside any worktree of the project keeps the marker, and it says so', async ({
      fresh,
      scratch,
      expect,
    }) => {
      const repo = await pending(fresh)
      const dir = scratch()
      writeFileSync(path.join(dir, 'plano.md'), planComment)
      const run = await bash(
        repo,
        `cd ${JSON.stringify(dir)} && gh issue comment 5 -R geazioliveira/marketo-sandbox --body-file plano.md`,
        `${ISSUE_URL}/5#issuecomment-43\n`,
      )
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(cacheExists(repo)).toBe(true)
      expect(contextOf(run)).toContain(
        'roda fora de uma worktree deste projeto',
      )
    })
  },
)

describe.concurrent(
  'plan-to-issue on Bash: how the target and the labels are read',
  () => {
    test('the last -R wins, as in gh', async ({ fresh, expect }) => {
      const counted = await pending(fresh)
      counted.write({ 'plano.md': planComment })
      await bash(
        counted,
        'gh issue comment 5 -R someone/else -R geazioliveira/marketo-sandbox --body-file plano.md',
        `${ISSUE_URL}/5#issuecomment-20\n`,
      )
      expect(existsSync(counted.markerPath(SESSION))).toBe(false)

      const kept = await pending(fresh)
      kept.write({ 'plano.md': planComment })
      const run = await bash(
        kept,
        'gh issue comment 5 -R geazioliveira/marketo-sandbox -R someone/else --body-file plano.md',
        `${ISSUE_URL}/5#issuecomment-21\n`,
      )
      expect(run.stdout).toBe('')
      expect(existsSync(kept.markerPath(SESSION))).toBe(true)
    })

    test('-R before the issue number is a flag and its value, not the issue', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      await bash(
        repo,
        'gh issue comment -R geazioliveira/marketo-sandbox 5 --body-file plano.md',
        `${ISSUE_URL}/5#issuecomment-22\n`,
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    })

    test('GH_REPO from the environment the hook inherits, which the line overrides', async ({
      fresh,
      expect,
    }) => {
      const elsewhere = await pending(fresh)
      elsewhere.write({ 'plano.md': planComment })
      const run = await bash(
        elsewhere,
        'gh issue comment 5 --body-file plano.md',
        `${ISSUE_URL}/5#issuecomment-23\n`,
        { env: elsewhere.env({ GH_REPO: 'someone/else' }) },
      )
      expect(run.stdout).toBe('')
      expect(existsSync(elsewhere.markerPath(SESSION))).toBe(true)

      const overridden = await pending(fresh)
      overridden.write({ 'plano.md': planComment })
      await bash(
        overridden,
        'GH_REPO=geazioliveira/marketo-sandbox gh issue comment 5 --body-file plano.md',
        `${ISSUE_URL}/5#issuecomment-24\n`,
        { env: overridden.env({ GH_REPO: 'someone/else' }) },
      )
      expect(existsSync(overridden.markerPath(SESSION))).toBe(false)
    })

    test('a non-project repository with a marker does nothing, even when -R names the project', async ({
      fresh,
      expect,
    }) => {
      const repo = await fresh({
        branch: BRANCH,
        origin: 'https://github.com/someone/else.git',
        marker: SESSION,
      })
      repo.write({ 'plano.md': planComment })
      const run = await bash(
        repo,
        'gh issue comment 5 -R geazioliveira/marketo-sandbox --body-file plano.md',
        `${ISSUE_URL}/5#issuecomment-25\n`,
      )
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
    })

    test('category labels are read without case and trimmed, as GitHub matches them', async ({
      fresh,
      expect,
    }) => {
      for (const labels of [
        '-l Bug -l ready-for-human',
        "-l 'ready-for-human, bug'",
      ]) {
        const repo = await pending(fresh)
        repo.write({ 'feat.md': sectionsOf(featureSections) })
        const run = await bash(
          repo,
          `gh issue create -t Falha ${labels} -F feat.md`,
          `${ISSUE_URL}/30\n`,
        )
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
        expect(contextOf(run)).toContain('faltam')
      }
      const repo = await pending(fresh)
      repo.write({ 'feat.md': sectionsOf(featureSections) })
      await bash(
        repo,
        'gh issue create -t Coisa -l Enhancement -F feat.md',
        `${ISSUE_URL}/31\n`,
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
    })

    test('other gh issue verbs never count, even with a # Plano body and the issue URL', async ({
      fresh,
      expect,
    }) => {
      // gh issue edit prints the issue URL; the others would print nothing,
      // but the verb decides, not the output.
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      for (const command of [
        'gh issue edit 5 --body-file plano.md',
        'gh issue view 5 --body-file plano.md',
        'gh issue close 5 --body-file plano.md',
        'gh pr create --body-file plano.md',
      ]) {
        const run = await bash(repo, command, `${ISSUE_URL}/5\n`)
        expect(run.status).toBe(0)
        expect(run.stdout).toBe('')
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      }
    })
  },
)

/**
 * The input after a Monitor or mcp__terminal__run_in_terminal call: the same
 * command as Bash, a response that may hold no stdout of gh's (Monitor starts
 * the command in the background; run_in_terminal runs it in the person's
 * terminal), and run_in_terminal's own cwd.
 */
function otherTool(
  repo: HookRepo,
  tool: 'Monitor' | 'mcp__terminal__run_in_terminal',
  command: string,
  response: unknown,
  {
    toolInput = {},
    cwd = repo.dir,
    env,
  }: {
    toolInput?: Record<string, unknown>
    cwd?: string
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<HookRun> {
  return repo.run(
    'plan-to-issue',
    {
      session_id: SESSION,
      transcript_path: path.join(repo.root, 'transcript.jsonl'),
      cwd,
      permission_mode: 'auto',
      hook_event_name: 'PostToolUse',
      tool_name: tool,
      tool_input: { command, description: 'Publicar o plano', ...toolInput },
      tool_response: response,
    },
    { env },
  )
}

/** An instant after the marker a spec just wrote: GitHub's clock, as ISO. */
const later = () => new Date(Date.now() + 60_000).toISOString()
const earlier = () => new Date(Date.now() - 3_600_000).toISOString()

describe.concurrent(
  'plan-to-issue on Monitor and run_in_terminal (Copilot review of #26)',
  () => {
    const comment = 'gh issue comment 5 --body-file plano.md'

    test('a # Plano comment of the account, after the marker, read live on the issue, removes it', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      repo.setFixture({
        comments: {
          5: {
            comments: [
              { body: 'Antes.', createdAt: earlier(), viewerDidAuthor: true },
              { body: planComment, createdAt: later(), viewerDidAuthor: true },
            ],
          },
        },
      })
      const run = await otherTool(repo, 'Monitor', comment, {
        taskId: 'b1',
        status: 'running',
      })
      expect(run.status).toBe(0)
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
      expect(contextOf(run)).toContain('plano publicado na issue #5')
      expect(contextOf(run)).toContain('o marcador foi removido')
      expect(repo.calls()).toEqual([
        expect.objectContaining({ call: 'issueComments', key: '5' }),
      ])
    })

    test('the issue URL in the response counts as on Bash, with no live read', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      mkdirSync(path.join(repo.dir, 'docs'))
      repo.write({ 'docs/plano.md': planComment })
      const run = await otherTool(
        repo,
        'mcp__terminal__run_in_terminal',
        comment,
        `${ISSUE_URL}/5#issuecomment-9\n`,
        { toolInput: { cwd: 'docs' } },
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
      expect(contextOf(run)).toContain(`plano publicado em ${ISSUE_URL}/5`)
      expect(repo.calls()).toEqual([])
    })

    test('gh issue create, read live among the account’s newest issues', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'issue.md': sectionsOf(featureSections) })
      repo.setFixture({
        viewerIssues: {
          issues: [
            {
              number: 30,
              createdAt: later(),
              title: 'Uma coisa',
              body: sectionsOf(featureSections),
              repo: 'geazioliveira/marketo-sandbox',
              labels: ['enhancement', TO],
            },
          ],
        },
      })
      const run = await otherTool(
        repo,
        'mcp__terminal__run_in_terminal',
        `gh issue create --title 'Uma coisa' --label enhancement,${TO} --body-file issue.md`,
        'Comando enviado ao terminal.',
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
      expect(contextOf(run)).toContain('plano publicado na issue #30')
      expect(repo.calls()).toEqual([
        expect.objectContaining({ call: 'viewerIssues' }),
      ])
    })

    test.for([
      [
        'a # Plano comment from before the marker',
        { body: planComment, createdAt: earlier(), viewerDidAuthor: true },
      ],
      [
        'a # Plano comment of another account',
        { body: planComment, createdAt: later(), viewerDidAuthor: false },
      ],
      [
        'a comment that does not open with # Plano',
        {
          body: `Resumo.\n\n${planComment}`,
          createdAt: later(),
          viewerDidAuthor: true,
        },
      ],
    ] as const)(
      'keeps the marker for %s, and says so',
      async ([, found], { fresh, expect }) => {
        const repo = await pending(fresh)
        repo.write({ 'plano.md': planComment })
        repo.setFixture({ comments: { 5: { comments: [found] } } })
        const run = await otherTool(repo, 'Monitor', comment, { taskId: 'b2' })
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
        expect(contextOf(run)).toContain('o marcador continua')
        expect(contextOf(run)).toContain('#5')
      },
    )

    test('keeps the marker when the live read fails, and says so', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      repo.setFixture({ comments: { 5: { mode: 'fail', comments: [] } } })
      const run = await otherTool(repo, 'Monitor', comment, { taskId: 'b3' })
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain('não consegui confirmar no GitHub')
      expect(contextOf(run)).toContain('o marcador continua')
    })

    test.for([
      ['created before the marker', () => ({ createdAt: earlier() })],
      ['in another repository', () => ({ repo: 'alguem/outro' })],
      ['under another title', () => ({ title: 'Outra coisa' })],
      [
        'without the plan’s sections',
        () => ({ body: 'Só um resumo, sem as seções.' }),
      ],
    ] as const)(
      'keeps the marker for gh issue create when the account’s one new issue is %s',
      async ([, change], { fresh, expect }) => {
        const repo = await pending(fresh)
        repo.write({ 'issue.md': sectionsOf(featureSections) })
        repo.setFixture({
          viewerIssues: {
            issues: [
              {
                number: 30,
                createdAt: later(),
                title: 'Uma coisa',
                body: sectionsOf(featureSections),
                repo: 'geazioliveira/marketo-sandbox',
                labels: ['enhancement'],
                ...change(),
              },
            ],
          },
        })
        const run = await otherTool(
          repo,
          'Monitor',
          `gh issue create -t 'Uma coisa' -l enhancement -F issue.md`,
          { taskId: 'b4' },
        )
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
        expect(contextOf(run)).toContain('o marcador continua')
      },
    )

    test('removes it for that same issue, as it is', async ({
      fresh,
      expect,
    }) => {
      // The control of the cases above: each differs from this one issue in
      // one field only.
      const repo = await pending(fresh)
      repo.write({ 'issue.md': sectionsOf(featureSections) })
      repo.setFixture({
        viewerIssues: {
          issues: [
            {
              number: 30,
              createdAt: later(),
              title: 'Uma coisa',
              body: sectionsOf(featureSections),
              repo: 'geazioliveira/marketo-sandbox',
              labels: ['enhancement'],
            },
          ],
        },
      })
      const run = await otherTool(
        repo,
        'Monitor',
        `gh issue create -t 'Uma coisa' -l enhancement -F issue.md`,
        { taskId: 'b4' },
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
      expect(contextOf(run)).toContain('plano publicado na issue #30')
    })

    test('a body it cannot read is read on GitHub instead', async ({
      fresh,
      expect,
    }) => {
      // Through Monitor, `--body "$PLANO"` may well be the plan: the comment
      // GitHub holds decides.
      const repo = await pending(fresh)
      repo.setFixture({
        comments: {
          5: {
            comments: [
              { body: planComment, createdAt: later(), viewerDidAuthor: true },
            ],
          },
        },
      })
      const run = await otherTool(
        repo,
        'Monitor',
        'gh issue comment 5 --body "$PLANO"',
        { taskId: 'b5' },
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(false)
      expect(contextOf(run)).toContain('plano publicado na issue #5')
      expect(repo.calls()).toEqual([
        expect.objectContaining({ call: 'issueComments', key: '5' }),
      ])
    })

    test('answers with the budget’s reason when GitHub is too slow for it, and keeps the marker', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      repo.setFixture({ comments: { 5: { mode: 'slow', comments: [] } } })
      const run = await otherTool(
        repo,
        'Monitor',
        comment,
        { taskId: 'b6' },
        {
          env: repo.env({
            LOOP_HOOKS_BUDGET_MS: '2000',
            LOOP_HOOKS_GH_TIMEOUT_MS: '8000',
            FAKE_GH_SLOW_MS: '60000',
          }),
        },
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toContain('o prazo de 2 s do hook acabou')
      expect(contextOf(run)).toContain(
        'O marcador do plano pendente continua como estava',
      )
    })
  },
)

describe.concurrent('plan-to-issue: input it cannot use', () => {
  test('input that is not a JSON object exits 0 and prints nothing', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    for (const input of ['', 'não é json', '[1, 2]', 'null']) {
      const run = await repo.run('plan-to-issue', input)
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
    }
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
  })

  test('other tools, and a Bash call with no command, do nothing', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    for (const input of [
      {
        session_id: SESSION,
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: 'x' },
      },
      {
        session_id: SESSION,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: {},
      },
    ]) {
      const run = await repo.run('plan-to-issue', input)
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
    }
    expect(existsSync(repo.markerPath(SESSION))).toBe(true)
  })
})

describe.concurrent('plan-to-issue with the other hooks', () => {
  test('after the plan is published, SessionStart asks for the gate again instead of reading the old cache', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    const start = {
      session_id: SESSION,
      hook_event_name: 'SessionStart',
      source: 'resume',
    }
    const before = await repo.run('session-context', start)
    expect(contextOf(before)).toContain(
      'plano aceito nesta sessão e ainda não publicado',
    )
    expect(contextOf(before)).not.toContain('Gate aberto')

    repo.write({ 'plano.md': planComment })
    await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-14\n`,
    )
    const after = await repo.run('session-context', start)
    expect(contextOf(after)).toContain('Gate sem cache nesta worktree')
    expect(contextOf(after)).not.toContain('Gate aberto')
    expect(contextOf(after)).not.toContain('plano aceito')
  })

  test('after the plan is published, build-guard denies an edit until the gate runs again', async ({
    fresh,
    expect,
  }) => {
    const repo = await pending(fresh)
    const edit = {
      session_id: SESSION,
      hook_event_name: 'PreToolUse',
      permission_mode: 'default',
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(repo.dir, 'src', 'app.ts'),
        old_string: 'a',
        new_string: 'b',
      },
    }
    const before = await repo.run('build-guard', edit)
    expect(before.json?.hookSpecificOutput?.permissionDecision).toBe('ask')

    repo.write({ 'plano.md': planComment })
    await bash(
      repo,
      'gh issue comment 5 --body-file plano.md',
      `${ISSUE_URL}/5#issuecomment-15\n`,
    )
    const after = await repo.run('build-guard', edit)
    expect(after.json?.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(after.json?.hookSpecificOutput?.permissionDecisionReason).toContain(
      'npm run gate',
    )
  })
})

// ---------------------------------------------------------------------------
// Fourth round of Copilot's review of #26

describe.concurrent(
  'plan-to-issue on Bash: the host gh publishes to (Copilot review of #26, fourth round)',
  () => {
    const url = `${ISSUE_URL}/5#issuecomment-40`
    const anotherGithub = /ghe\.example\.com, outro GitHub/

    test.for([
      [
        'GH_HOST on the command',
        'GH_HOST=ghe.example.com gh issue comment 5 --body-file plano.md',
      ],
      [
        'GH_HOST exported earlier on the line',
        'export GH_HOST=ghe.example.com; gh issue comment 5 --body-file plano.md',
      ],
      [
        '-R HOST/OWNER/REPO',
        'gh issue comment 5 -R ghe.example.com/geazioliveira/marketo-sandbox --body-file plano.md',
      ],
      [
        'GH_REPO HOST/OWNER/REPO',
        'GH_REPO=ghe.example.com/geazioliveira/marketo-sandbox gh issue comment 5 --body-file plano.md',
      ],
    ])(
      'keeps the marker for %s, another GitHub, keeps the caches, and says why',
      async ([, command], { fresh, expect }) => {
        const repo = await pending(fresh)
        repo.write({ 'plano.md': planComment })
        const run = await bash(repo, command, `${url}\n`)
        expect(run.status).toBe(0)
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
        expect(cacheExists(repo)).toBe(true)
        expect(contextOf(run)).toMatch(anotherGithub)
        expect(contextOf(run)).toContain('o marcador continua')
      },
    )

    test('keeps the marker for GH_HOST the hook inherits', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      const run = await bash(
        repo,
        'gh issue comment 5 --body-file plano.md',
        `${url}\n`,
        { env: repo.env({ GH_HOST: 'ghe.example.com' }) },
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(cacheExists(repo)).toBe(true)
      expect(contextOf(run)).toMatch(anotherGithub)
    })

    test.for([
      [
        'on the command',
        'GH_HOST=$HOST gh issue comment 5 --body-file plano.md',
      ],
      [
        'exported earlier on the line',
        'export GH_HOST="$HOST"; gh issue comment 5 --body-file plano.md',
      ],
    ])(
      'keeps the marker for a GH_HOST it cannot read %s, and says so',
      async ([, command], { fresh, expect }) => {
        const repo = await pending(fresh)
        repo.write({ 'plano.md': planComment })
        const run = await bash(repo, command, `${url}\n`)
        expect(existsSync(repo.markerPath(SESSION))).toBe(true)
        expect(contextOf(run)).toContain(
          'não consegui ler em que issue, repositório ou host',
        )
      },
    )

    test('keeps the marker when a Monitor publication goes to another host, without asking github.com', async ({
      fresh,
      expect,
    }) => {
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      // github.com shows a # Plano comment of the account: it is not the one
      // this command posted, which went to the other host.
      repo.setFixture({
        comments: {
          5: {
            comments: [
              { body: planComment, createdAt: later(), viewerDidAuthor: true },
            ],
          },
        },
      })
      const run = await otherTool(
        repo,
        'Monitor',
        'export GH_HOST=ghe.example.com; gh issue comment 5 --body-file plano.md',
        { taskId: 'b1', status: 'running' },
      )
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(contextOf(run)).toMatch(anotherGithub)
      expect(repo.calls()).toEqual([])
    })

    test.for([
      [
        'GH_HOST=github.com',
        'GH_HOST=github.com gh issue comment 5 --body-file plano.md',
      ],
      [
        '-R github.com/OWNER/REPO over another GH_HOST',
        'GH_HOST=ghe.example.com gh issue comment 5 -R github.com/geazioliveira/marketo-sandbox --body-file plano.md',
      ],
    ])(
      'still counts %s: github.com is this project’s host',
      async ([, command], { fresh, expect }) => {
        const repo = await pending(fresh)
        repo.write({ 'plano.md': planComment })
        const run = await bash(repo, command, `${url}\n`)
        expect(existsSync(repo.markerPath(SESSION))).toBe(false)
        expect(contextOf(run)).toContain('o marcador foi removido')
      },
    )
  },
)

describe.concurrent(
  'plan-to-issue when a library does not load (Copilot review of #26, fourth round)',
  () => {
    /**
     * A copy of the hooks whose contract module does not parse: the import
     * of the libraries fails, as a broken edit or a bad merge would make it.
     */
    const brokenTree = (root: string): string => {
      const hooks = path.join(root, '.claude', 'hooks')
      cpSync(hooksDir, hooks, { recursive: true })
      mkdirSync(path.join(root, 'scripts'))
      const contract = path.join(root, 'scripts', 'loop-sections.mjs')
      cpSync(path.join(projectRoot, 'scripts', 'loop-sections.mjs'), contract)
      appendFileSync(contract, '\nexport const quebrado = (\n')
      return path.join(hooks, 'plan-to-issue.mjs')
    }

    const runBroken = (
      script: string,
      repo: HookRepo,
      input: Record<string, unknown>,
      cwd = repo.dir,
    ) =>
      spawnWith(process.execPath, [script], {
        input: JSON.stringify({
          transcript_path: path.join(repo.root, 'transcript.jsonl'),
          cwd,
          hook_event_name: 'PostToolUse',
          ...input,
        }),
        env: repo.env(),
        cwd,
      })

    test('writes the marker on ExitPlanMode anyway, in the common git dir, and tells Claude through exit 2', async ({
      fresh,
      scratch,
      expect,
    }) => {
      const script = brokenTree(scratch())
      const repo = await fresh()
      const worktree = await repo.addWorktree('wt-5', BRANCH)
      const run = await runBroken(
        script,
        repo,
        {
          session_id: SESSION,
          tool_name: 'ExitPlanMode',
          tool_input: { plan: planComment },
        },
        worktree.dir,
      )
      // PostToolUse: exit 2 shows stderr to Claude; exit 1 would only show
      // a notice to the person.
      expect(run.status).toBe(2)
      expect(run.stderr).toContain(
        'o plan-to-issue não carregou suas bibliotecas',
      )
      expect(run.stderr).toContain('publique-o numa issue antes de construir')
      // The common git dir, which every worktree shares, as the hook writes it.
      const marker = JSON.parse(
        readFileSync(repo.markerPath(SESSION), 'utf8'),
      ) as Record<string, unknown>
      expect(marker).toMatchObject({ schema: 1, sessionId: SESSION })
      expect(Number.isNaN(Date.parse(String(marker.acceptedAt)))).toBe(false)
      expect(
        existsSync(path.join(worktree.gitDir, planPendingFile(SESSION))),
      ).toBe(false)
    })

    test('names the marker as planPendingFile does, for any session id', async ({
      fresh,
      scratch,
      expect,
    }) => {
      const script = brokenTree(scratch())
      const repo = await fresh({ branch: BRANCH })
      for (const id of [
        'abc-123',
        '0f5e1c9a-9d2b-4a61-8c3e-7a1b2c3d4e5f',
        'sessão com/../barra',
        '',
        undefined,
      ]) {
        const before = new Set(readdirSync(repo.gitDir))
        const run = await runBroken(script, repo, {
          ...(id === undefined ? {} : { session_id: id }),
          tool_name: 'ExitPlanMode',
          tool_input: { plan: '# Plano' },
        })
        expect(run.status).toBe(2)
        const added = readdirSync(repo.gitDir).filter(
          (name) => !before.has(name),
        )
        const expected = planPendingFile(id ?? null)
        expect(added).toEqual(before.has(expected) ? [] : [expected])
        expect(existsSync(path.join(repo.gitDir, expected))).toBe(true)
        expect(expected.startsWith(planPendingPrefix)).toBe(true)
      }
    })

    test('never removes the marker on a publication, and tells Claude through exit 2', async ({
      fresh,
      scratch,
      expect,
    }) => {
      const script = brokenTree(scratch())
      const repo = await pending(fresh)
      repo.write({ 'plano.md': planComment })
      const run = await runBroken(script, repo, {
        session_id: SESSION,
        tool_name: 'Bash',
        tool_input: { command: 'gh issue comment 5 --body-file plano.md' },
        tool_response: {
          stdout: `${ISSUE_URL}/5#issuecomment-50\n`,
          stderr: '',
          interrupted: false,
          isImage: false,
        },
      })
      expect(run.status).toBe(2)
      expect(run.stderr).toContain(
        'o plan-to-issue não carregou suas bibliotecas',
      )
      expect(run.stderr).toContain('continua como estava')
      expect(existsSync(repo.markerPath(SESSION))).toBe(true)
      expect(cacheExists(repo)).toBe(true)
    })
  },
)
