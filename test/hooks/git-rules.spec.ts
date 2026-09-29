import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  skipChecksTrailer,
  skipCiTokens,
} from '../../scripts/loop-sections.mjs'
import {
  type Decision,
  type HookRepo,
  hookRepo,
  type IoLib,
  loadHookLib,
  raiseInProcessGitTimeout,
  type RepoInfo,
  type RepoLib,
  type ShellLib,
  type SimpleCommand,
  setupTimeout,
  processTimeout,
} from '../support/hooks'

/**
 * The rules for `git` (.claude/hooks/lib/git-rules.mjs): nothing is
 * committed on main or pushed to it, and no commit message turns the checks
 * off. They run in process against real throwaway repositories, since which
 * repository and which branch a command lands in is the whole question: the
 * one around the command's directory, after every `-C`.
 */

/** repoAt's answer as guard-bash hands it on: branchKnown false when an earlier command moved HEAD. */
type SeenRepo = RepoInfo & { branchKnown?: boolean }

interface FileText {
  known: boolean
  text: string | null
}

interface GitCtx {
  cwd: string
  repoAt: (dir: string) => SeenRepo | null
  cwdKnown?: boolean
  env?: NodeJS.ProcessEnv
  lineConfig?: { pair: string; known: boolean }[]
  files?: (file: string) => FileText | undefined
  cache?: Map<string, unknown>
  /** The hook's input: the session whose plan marker counts, and its cwd. */
  input?: { session_id?: string; cwd?: string }
}

interface HeadChange {
  dir: string
  dirKnown: boolean
  head: { known: boolean; branch: string | null }
}

interface RemoteChange {
  dir: string
  dirKnown: boolean
  everywhere: boolean
  origin: { known: boolean; url: string } | null
}

interface GitRulesLib {
  gitDecision(command: SimpleCommand, ctx: GitCtx): Decision
  headChangeOf(command: SimpleCommand, ctx: GitCtx): HeadChange | null
  remoteChangeOf(command: SimpleCommand, ctx: GitCtx): RemoteChange | null
  configSetBy(
    command: SimpleCommand,
    ctx: GitCtx,
  ): { pair: string; known: boolean }[]
  definesAlias(command: SimpleCommand, ctx?: Partial<GitCtx>): boolean
  skipTokenIn(text: unknown): string | null
  readSource(
    command: Partial<SimpleCommand>,
    dir: string,
    value: string,
    known?: boolean,
    files?: ((file: string) => FileText | undefined) | null,
  ): FileText
}

let git: GitRulesLib
let shell: ShellLib
let io: IoLib
let repoLib: RepoLib

/**
 * main checked out, a feature branch, another project's main, and no
 * repository at all; main with aliases in its config; and a fork's clone,
 * whose origin is the fork and whose `upstream` is this project.
 */
let onMain: HookRepo
let onFeature: HookRepo
let elsewhere: HookRepo
let aliased: HookRepo
let fork: HookRepo
let outside: string

const PROJECT_URL = 'https://github.com/geazioliveira/marketo-sandbox.git'

const FEATURE = 'feature/5-hooks-claude-code'

beforeAll(async () => {
  ;[git, shell, io, repoLib] = await Promise.all([
    loadHookLib<GitRulesLib>('git-rules'),
    loadHookLib<ShellLib>('shell'),
    loadHookLib<IoLib>('io'),
    loadHookLib<RepoLib>('repo'),
  ])
  // The branch of the issue has its gate open: the rules for messages and
  // pushes are judged here, and a merge or a cherry-pick also writes the
  // worktree, which the gate lets through only when open.
  ;[onMain, onFeature, elsewhere, aliased, fork] = await Promise.all([
    hookRepo(),
    hookRepo({ branch: FEATURE, cache: true }),
    hookRepo({ origin: 'https://github.com/alguem/outro.git' }),
    hookRepo(),
    hookRepo({ branch: FEATURE, origin: 'https://github.com/alguem/fork.git' }),
  ])
  // One after the other: two `git config` at once in the same repository
  // race for the lock on .git/config, and the loser fails.
  await aliased.git('config', 'alias.ci', 'commit')
  await aliased.git('config', 'alias.chain', 'ci -q')
  await aliased.git('config', 'alias.sh', '!git push origin HEAD:main')
  await aliased.git('config', 'alias.loop', 'loop')
  await fork.git('remote', 'add', 'upstream', PROJECT_URL)
  outside = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'git-rules-')))
  // Untracked files: the rules only read them.
  onFeature.write({ 'msg-skip.txt': 'Hooks\n\n[skip ci]\n' })
  mkdirSync(path.join(onMain.dir, 'sub'))
}, setupTimeout)

afterAll(() => {
  for (const repo of [onMain, onFeature, elsewhere, aliased, fork])
    repo?.remove()
  if (outside) rmSync(outside, { recursive: true, force: true })
}, setupTimeout)

vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })
// The libraries run in this process: their git gets 60 s, as a hook's does (#59).
raiseInProcessGitTimeout()

/**
 * repoAt's answers by directory: the repositories are only read here, and
 * each answer costs three git processes.
 */
const known = new Map<string, RepoInfo | null>()

interface JudgeOptions {
  /** What guard-bash would say about the repository: a branch an earlier command moved to. */
  seen?: (repo: RepoInfo) => SeenRepo
  lineConfig?: GitCtx['lineConfig']
  files?: GitCtx['files']
  env?: Record<string, string>
  /** The hook's input; a session with no plan marker, in `cwd`, when absent. */
  input?: GitCtx['input']
}

/**
 * Every git command of the line through gitDecision, combined as guard-bash
 * does, with the directories repoAt was asked about. The environment is a
 * clean one: the machine's own git config must not decide a case.
 */
function judge(
  text: string,
  cwd: string,
  { seen, lineConfig, files, env = {}, input }: JudgeOptions = {},
): { decision: Decision; asked: string[] } {
  const asked: string[] = []
  const repoAt = (dir: string) => {
    asked.push(dir)
    if (!known.has(dir))
      known.set(dir, repoLib.repoAt(dir, { env: onMain.env() }))
    const repo = known.get(dir) ?? null
    return repo !== null && seen !== undefined ? seen(repo) : repo
  }
  const decisions = shell
    .parseCommand(text)
    .commands.filter((command) => command.argv[0] === 'git')
    .map((command) =>
      git.gitDecision(command, {
        cwd: path.resolve(cwd, command.cwd ?? '.'),
        repoAt,
        env: onMain.env(env),
        lineConfig,
        files,
        input: input ?? { session_id: 'spec-git-rules', cwd },
      }),
    )
  return { decision: io.combine(decisions), asked }
}

const verdict = (text: string, cwd: string, options?: JudgeOptions) =>
  judge(text, cwd, options).decision

/** The first command of a line, parsed. */
const commandOf = (text: string) => shell.parseCommand(text).commands[0]

const ctxAt = (cwd: string): GitCtx => ({
  cwd,
  repoAt: (dir) => repoLib.repoAt(dir, { env: onMain.env() }),
  env: onMain.env(),
})

const onTrunk = 'commit em main: trabalhe numa branch da issue'
const pushTrunk = /^push em main: a mudança entra por PR/

describe('commits on main', () => {
  it.each([
    'git commit -m "Hooks"',
    'git commit -am "Hooks"',
    'git commit --amend --no-edit',
    'git merge feature/5-x',
    'git merge --ff-only origin/main',
    'git merge --continue',
    'git cherry-pick abc123',
    'git revert HEAD',
    'git am 0001.patch',
  ])('denies %s with main checked out', (text) => {
    // A merge, a cherry-pick, a revert and an am also write the worktree,
    // which main refuses too (fourth round): both reasons are given.
    expect(verdict(text, onMain.dir)).toMatchObject({
      decision: 'deny',
      reason: expect.stringContaining(onTrunk) as string,
    })
  })

  it.each([
    'git merge --abort',
    'git cherry-pick --quit',
    'git revert --abort',
  ])('passes %s, which makes no commit', (text) => {
    expect(verdict(text, onMain.dir).decision).toBe('pass')
  })

  it('passes a commit on a branch of the issue', () => {
    expect(verdict('git commit -m "Hooks"', onFeature.dir).decision).toBe(
      'pass',
    )
    expect(verdict('git merge origin/main', onFeature.dir).decision).toBe(
      'pass',
    )
  })

  it('follows -C, each one relative to the last', () => {
    expect(
      verdict(`git -C ${onFeature.dir} commit -m x`, onMain.dir).decision,
    ).toBe('pass')
    expect(
      verdict(`git -C ${onMain.dir} commit -m x`, onFeature.dir).decision,
    ).toBe('deny')
    expect(
      verdict(`git -C ${path.dirname(onMain.dir)} -C repo commit -m x`, outside)
        .decision,
    ).toBe('deny')
  })

  it('skips the values of -c and --git-dir before the subcommand', () => {
    expect(
      verdict('git -c user.name=x --no-pager commit -m x', onMain.dir).decision,
    ).toBe('deny')
  })

  it('reads a subdirectory as its repository', () => {
    expect(verdict('cd sub && git commit -m x', onMain.dir).decision).toBe(
      'deny',
    )
  })

  it('passes a commit in another repository or outside any', () => {
    expect(verdict('git commit -m "x [skip ci]"', elsewhere.dir).decision).toBe(
      'pass',
    )
    expect(verdict('git commit -m x', outside).decision).toBe('pass')
  })
})

describe('skip strings in commit messages', () => {
  it.each(skipCiTokens)('denies %s, in any case', (token) => {
    const decision = verdict(
      `git commit -m "Hooks ${token.toUpperCase()}"`,
      onFeature.dir,
    )
    expect(decision.decision).toBe('deny')
    expect(decision.reason).toContain(token)
  })

  it.each([
    ['the trailer', `-m "Hooks" -m "${skipChecksTrailer}"`],
    ['the trailer with no space', '-m "Hooks\n\n\nskip-checks:true"'],
    ['a clustered -am', '-am "x [no ci]"'],
    ['a glued -m', '"-mx [skip ci]"'],
    ['--message=', '"--message=x [skip ci]"'],
    ['an abbreviated --mess', '--mess "x [skip ci]"'],
    ['the second -m', '-m ok -m "[skip ci]"'],
    ['-F with a file', '-F msg-skip.txt'],
    ['--file= with a file', '--file=msg-skip.txt'],
  ])('denies %s', (_, args) => {
    expect(verdict(`git commit ${args}`, onFeature.dir).decision).toBe('deny')
  })

  it('reads -F - from a heredoc', () => {
    const text = `git commit -F - <<'EOF'\nHooks\n\n[actions skip]\nEOF`
    expect(verdict(text, onFeature.dir).decision).toBe('deny')
  })

  it('reads -F relative to the -C directory', () => {
    expect(
      verdict(`git -C ${onFeature.dir} commit -F msg-skip.txt`, outside).reason,
    ).toMatch(/\[skip ci\]/)
  })

  it.each([
    ['an ordinary message', '-m "Hooks do loop. Refs #5"'],
    ['a reused message', '-C HEAD'],
  ])('passes %s', (_, args) => {
    expect(verdict(`git commit ${args}`, onFeature.dir).decision).toBe('pass')
  })

  // Copilot review of #26, third round: a message it cannot read may carry a
  // skip string, so it asks, critical, and the autonomous modes refuse it.
  it.each([
    ['a message behind an expansion', '-m "$MSG"'],
    ['a file that is not there', '-F /nao/existe.txt'],
    ['a file behind an expansion', '-F "$FILE"'],
    ['a trailer behind an expansion', '-m Hooks --trailer "$TRAILER"'],
  ])('asks, critical, for %s', (_, args) => {
    expect(verdict(`git commit ${args}`, onFeature.dir)).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: expect.stringMatching(
        /^não consegui ler a mensagem do commit/,
      ) as string,
    })
  })
})

describe('skip strings in merge commit messages (Copilot review of #26)', () => {
  const skipInMerge = /^a mensagem do merge traz "/

  it.each([
    ['--no-ff -m', '--no-ff -m "[skip ci]" origin/main'],
    ['a glued -m', '--no-ff "-mTrazer main [ci skip]" origin/main'],
    ['--message=', '"--message=Trazer main [no ci]" origin/main'],
    ['an abbreviated --mess', '--mess "x [skip actions]" origin/main'],
    ['the trailer in the second -m', `-m ok -m "${skipChecksTrailer}" main`],
    ['-F with a file', '--no-ff -F msg-skip.txt origin/main'],
    ['--file= with a file', '--file=msg-skip.txt origin/main'],
    [
      '--into-name, a name git writes into the message',
      '--no-ff --into-name "x [skip ci]" origin/main',
    ],
  ])('denies %s', (_, args) => {
    const decision = verdict(`git merge ${args}`, onFeature.dir)
    expect(decision.decision).toBe('deny')
    expect(decision.reason).toMatch(skipInMerge)
  })

  it('reads -F - from a heredoc', () => {
    const text = `git merge --no-ff -F - origin/main <<'EOF'\nTrazer main\n\n[actions skip]\nEOF`
    expect(verdict(text, onFeature.dir).reason).toMatch(skipInMerge)
  })

  it('reads the values of -s and -X as options, not as a message', () => {
    expect(
      verdict('git merge -s ort -X "[skip ci]" origin/main', onFeature.dir)
        .decision,
    ).toBe('pass')
  })

  it.each([
    ['an ordinary message', '--no-ff -m "Trazer main. Refs #5" origin/main'],
    ['no message', 'origin/main'],
    ['--abort, which writes no commit', '--abort'],
  ])('passes %s', (_, args) => {
    expect(verdict(`git merge ${args}`, onFeature.dir).decision).toBe('pass')
  })

  it.each([
    ['a message behind an expansion', '-m "$MSG" origin/main'],
    ['a file behind an expansion', '-F "$FILE" origin/main'],
    ['an --into-name behind an expansion', '--into-name "$N" origin/main'],
  ])(
    'asks, critical, for %s (Copilot review of #26, third round)',
    (_, args) => {
      expect(verdict(`git merge ${args}`, onFeature.dir)).toMatchObject({
        decision: 'ask',
        critical: true,
        reason: expect.stringMatching(
          /^não consegui ler a mensagem do merge/,
        ) as string,
      })
    },
  )

  it('passes a merge in another repository', () => {
    expect(
      verdict('git merge --no-ff -m "[skip ci]" origin/main', elsewhere.dir)
        .decision,
    ).toBe('pass')
  })
})

describe('messages a commit brings from elsewhere (Copilot review of #26)', () => {
  /**
   * A branch of the issue whose history holds the messages another command
   * copies: a clean commit, then a skip string in a subject, in a body only,
   * and as the trailer, each by its sha; and the patches git format-patch
   * makes of three of them.
   */
  let sourced: HookRepo
  const sha = { base: '', clean: '', subject: '', body: '', trailer: '' }
  const patch = { clean: '', subject: '', body: '' }

  beforeAll(async () => {
    sourced = await hookRepo({ branch: FEATURE, cache: true })
    await sourced.commit({ 'a.txt': 'a\n' }, 'Limpo')
    await sourced.commit({ 'b.txt': 'b\n' }, 'Pular [skip ci]')
    await sourced.commit(
      { 'c.txt': 'c\n' },
      'Assunto limpo\n\nCorpo com [ci skip].',
    )
    await sourced.commit(
      { 'd.txt': 'd\n' },
      `Com trailer\n\n${skipChecksTrailer}`,
    )
    ;[sha.base, sha.clean, sha.subject, sha.body, sha.trailer] = (
      await sourced.git('rev-list', '--reverse', 'HEAD')
    ).split('\n')
    const dir = path.join(sourced.root, 'patches')
    for (const name of ['clean', 'subject', 'body'] as const)
      patch[name] = await sourced.git(
        'format-patch',
        '-1',
        sha[name],
        '-o',
        path.join(dir, name),
      )
  }, setupTimeout)

  afterAll(() => sourced?.remove(), setupTimeout)

  const at = (text: string) => verdict(text, sourced.dir)
  const refused = /traz "(?:\[skip ci\]|\[ci skip\]|skip-checks: true)"/

  it.each([
    ['cherry-pick of a subject', () => `git cherry-pick ${sha.subject}`],
    ['cherry-pick of a body', () => `git cherry-pick ${sha.body}`],
    ['cherry-pick of the trailer', () => `git cherry-pick -x ${sha.trailer}`],
    [
      'cherry-pick of a clean commit and one that is not',
      () => `git cherry-pick ${sha.clean} ${sha.subject}`,
    ],
    [
      'cherry-pick of a range',
      () => `git cherry-pick ${sha.base}..${sha.subject}`,
    ],
    ['revert of a subject', () => `git revert --no-edit ${sha.subject}`],
    ['am of a patch', () => `git am ${patch.subject}`],
    [
      'am of a patch with the string in its body',
      () => `git am -3 ${patch.body}`,
    ],
    ['am reading the patch on stdin', () => `git am < ${patch.subject}`],
    ['commit -C', () => `git commit -C ${sha.subject}`],
    ['commit -c', () => `git commit -c ${sha.body}`],
    [
      'commit --reuse-message=',
      () => `git commit --reuse-message=${sha.trailer}`,
    ],
    [
      'commit --reedit-message',
      () => `git commit --reedit-message ${sha.subject}`,
    ],
    ['commit --fixup of a subject', () => `git commit --fixup=${sha.subject}`],
    [
      'commit --fixup=amend: of a body',
      () => `git commit --fixup=amend:${sha.body}`,
    ],
    [
      'commit --squash of a subject',
      () => `git commit --squash ${sha.subject}`,
    ],
    [
      'commit --amend --no-edit of a HEAD that has one',
      () => 'git commit --amend --no-edit',
    ],
    // git's parse-options takes an unambiguous abbreviation.
    [
      'commit --amen --no-edit, which git reads as --amend',
      () => 'git commit --amen --no-edit',
    ],
  ])('denies %s that carries a skip string', (_, text) => {
    const decision = at(text())
    expect(decision.decision).toBe('deny')
    expect(decision.reason).toMatch(refused)
  })

  it.each([
    ['cherry-pick of a clean commit', () => `git cherry-pick ${sha.clean}`],
    [
      'cherry-pick of a clean range',
      () => `git cherry-pick ${sha.base}..${sha.clean}`,
    ],
    // git revert keeps the subject alone.
    [
      'revert of a commit with the string in its body only',
      () => `git revert ${sha.body}`,
    ],
    ['am of a clean patch', () => `git am ${patch.clean}`],
    ['commit -C of a clean commit', () => `git commit -C ${sha.clean}`],
    // --fixup and --squash copy the subject alone.
    ['commit --fixup of a body', () => `git commit --fixup ${sha.body}`],
    ['commit --squash of a body', () => `git commit --squash=${sha.body} -m x`],
    [
      'commit --amend with a new message',
      () => 'git commit --amend -m "Limpo"',
    ],
    ['cherry-pick --continue', () => 'git cherry-pick --continue'],
    ['am --abort', () => 'git am --abort'],
  ])('passes %s', (_, text) => {
    expect(at(text())).toEqual({ decision: 'pass' })
  })

  it.each([
    ['a revision behind an expansion', 'git cherry-pick "$SHA"'],
    ['a revision git does not know', 'git cherry-pick naoexiste123'],
    ['a revert of a substitution', 'git revert "$(git rev-parse HEAD)"'],
    ['a patch that is not there', 'git am /nao/existe.patch'],
    ['a patch read from a pipe', 'cat x.patch | git am'],
    ['commit -C behind an expansion', 'git commit -C "$REV"'],
  ])('asks, critical, for %s', (_, text) => {
    expect(at(text)).toMatchObject({ decision: 'ask', critical: true })
  })

  it('asks for a cherry-pick whose commits an option picks: they are not the revisions it names', () => {
    // Every commit of every branch that is not on main, the skip strings
    // among them; the hook would read only `^main`, which names none.
    expect(at('git cherry-pick --all ^main')).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: expect.stringMatching(/a opção --all escolhe commits/) as string,
    })
  })

  it('asks for a revision behind an expansion, even one git would take for a name', async () => {
    // A branch named `$LIMPO`, on a clean commit: git would read the word as
    // the hook sees it, but the shell hands git the variable's value.
    await sourced.git('branch', '-f', '$LIMPO', sha.clean)
    for (const text of ['git cherry-pick "$LIMPO"', 'git revert "$LIMPO"'])
      expect(at(text)).toMatchObject({
        decision: 'ask',
        critical: true,
        reason: expect.stringMatching(
          /a revisão "\$LIMPO" não pôde ser lida/,
        ) as string,
      })
  })

  it('reads the copied messages without the command’s -c, which could make the read run a program', () => {
    // A -c naming a promisor remote: git would fetch the commit it lacks
    // from it, and the ext:: transport runs any program. The read asks
    // instead, and runs nothing.
    const marker = path.join(sourced.root, 'buscou')
    const text = `git -c remote.lazy.promisor=true -c remote.lazy.url='ext::touch ${marker}' -c protocol.ext.allow=always cherry-pick ${'1'.repeat(40)}`
    expect(at(text)).toMatchObject({ decision: 'ask', critical: true })
    expect(existsSync(marker)).toBe(false)
  })

  it('runs nothing the environment’s config names either (fourth round)', () => {
    // The same config in GIT_CONFIG_COUNT, which the read keeps: git
    // fetches nothing, and core.fsmonitor, run when git reads the index
    // (`:a.txt`), is off.
    const fetched = path.join(sourced.root, 'buscou-pelo-ambiente')
    const fetch = `GIT_CONFIG_COUNT=3 GIT_CONFIG_KEY_0=remote.lazy.promisor GIT_CONFIG_VALUE_0=true GIT_CONFIG_KEY_1=remote.lazy.url GIT_CONFIG_VALUE_1='ext::touch ${fetched}' GIT_CONFIG_KEY_2=protocol.ext.allow GIT_CONFIG_VALUE_2=always git cherry-pick ${'1'.repeat(40)}`
    expect(at(fetch)).toMatchObject({ decision: 'ask', critical: true })
    expect(existsSync(fetched)).toBe(false)
    const monitored = path.join(sourced.root, 'monitorou')
    for (const text of [
      `git -c 'core.fsmonitor=touch ${monitored}' cherry-pick :a.txt`,
      `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0='touch ${monitored}' git revert :a.txt`,
    ]) {
      at(text)
      expect(existsSync(monitored)).toBe(false)
    }
  })

  it('follows the -c that decides which commit a name points at', async () => {
    // A replace ref shows the clean commit in place of the one with a skip
    // string in its subject: git cherry-pick copies the clean message, unless
    // core.useReplaceRefs=false makes it copy the original's.
    await sourced.git('replace', '-f', sha.subject, sha.clean)
    try {
      expect(at(`git cherry-pick ${sha.subject}`)).toEqual({ decision: 'pass' })
      for (const decision of [
        at(`git -c core.useReplaceRefs=false cherry-pick ${sha.subject}`),
        // The same, set by an earlier `git config` of the line.
        verdict(`git cherry-pick ${sha.subject}`, sourced.dir, {
          lineConfig: [{ pair: 'core.useReplaceRefs=false', known: true }],
        }),
      ]) {
        expect(decision.decision).toBe('deny')
        expect(decision.reason).toMatch(refused)
      }
      expect(
        at(`git -c core.useReplaceRefs="$V" revert ${sha.subject}`),
      ).toMatchObject({ decision: 'ask', critical: true })
    } finally {
      await sourced.git('replace', '-d', sha.subject)
    }
  })

  it('passes a cherry-pick in another repository, reading nothing', () => {
    const { decision } = judge('git cherry-pick "$SHA"', elsewhere.dir)
    expect(decision.decision).toBe('pass')
  })

  describe('patches as git am reads them', () => {
    const mail = (headers: string, body: string) =>
      `From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001\nFrom: Hooks Spec <hooks-spec@example.invalid>\nDate: Sat, 26 Sep 2026 10:00:00 -0300\n${headers}\n\n${body}`
    const diff =
      'diff --git a/x.md b/x.md\n--- a/x.md\n+++ b/x.md\n@@ -1 +1 @@\n-a\n+b\n'

    beforeAll(() => {
      sourced.write(
        {
          'qp.patch': mail(
            'Subject: [PATCH] Limpo\nContent-Transfer-Encoding: quoted-printable',
            'Corpo com =5Bskip ci=5D, codificado.\n---\n x.md | 2 +-\n\n' +
              diff,
          ),
          'b64.patch': mail(
            'Subject: [PATCH] Limpo\nContent-Transfer-Encoding: base64',
            `${Buffer.from(`Corpo.\n\n${skipChecksTrailer}\n---\n${diff}`).toString('base64')}\n`,
          ),
          'word.patch': mail(
            'Subject: [PATCH] =?UTF-8?q?Corre=C3=A7=C3=A3o_=5Bno_ci=5D?=',
            `Corpo.\n---\n${diff}`,
          ),
          'folded.patch': mail(
            'Subject: [PATCH] Um assunto longo que o format-patch dobra [skip\n ci] no meio',
            `Corpo.\n---\n${diff}`,
          ),
          'two.patch': `${mail('Subject: [PATCH 1/2] Limpo', `Corpo.\n---\n${diff}`)}\n${mail('Subject: [PATCH 2/2] Outro', `Corpo com [actions skip].\n---\n${diff}`)}`,
          // The diff may mention a skip string: it is no part of the message.
          'in-diff.patch': mail(
            'Subject: [PATCH] Documentar os tokens',
            'Corpo.\n---\ndiff --git a/AGENTS.md b/AGENTS.md\n--- a/AGENTS.md\n+++ b/AGENTS.md\n@@ -1 +1 @@\n-a\n+Nunca escreva [skip ci].\n',
          ),
          'multi.patch': mail(
            'Subject: [PATCH] Limpo\nContent-Type: multipart/mixed; boundary="x"',
            '--x\nContent-Type: text/plain\n\nCorpo.\n--x--\n',
          ),
        },
        path.join(sourced.root, 'mail'),
      )
    }, setupTimeout)

    const mailbox = (name: string) =>
      path.join(sourced.root, 'mail', `${name}.patch`)

    it.each([
      ['a quoted-printable body', 'qp'],
      ['a base64 body with the trailer', 'b64'],
      ['a subject in a MIME encoded word', 'word'],
      ['a folded subject', 'folded'],
      ['the second message of a mailbox', 'two'],
    ])('denies %s', (_, name) => {
      const decision = at(`git am ${mailbox(name)}`)
      expect(decision.decision).toBe('deny')
      expect(decision.reason).toMatch(/a mensagem do patch que o git am aplica/)
    })

    it('passes a patch whose diff, not its message, mentions a skip string', () => {
      expect(at(`git am ${mailbox('in-diff')}`)).toEqual({ decision: 'pass' })
    })

    it('asks, critical, for a multipart message it does not read', () => {
      expect(at(`git am ${mailbox('multi')}`)).toMatchObject({
        decision: 'ask',
        critical: true,
      })
    })
  })
})

describe('pushes to main', () => {
  it.each([
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin +feature/5-x:main',
    'git push origin :main',
    'git push origin HEAD:refs/heads/main',
    'git push origin x:heads/main',
    'git push --all origin',
    'git push --mirror',
    'git push --al origin',
    'git push origin --delete main',
    'git push -d origin main',
    "git push origin 'refs/heads/*:refs/heads/*'",
    'git push origin x:HEAD',
    'git push -o ci.skip origin main',
  ])('denies %s from a branch of the issue', (text) => {
    const decision = verdict(text, onFeature.dir)
    expect(decision.decision).toBe('deny')
    expect(decision.reason).toMatch(pushTrunk)
  })

  it.each([
    'git push',
    'git push -u origin',
    'git push origin HEAD',
    'git push --force-with-lease origin HEAD',
  ])('denies %s with main checked out', (text) => {
    expect(verdict(text, onMain.dir).reason).toMatch(pushTrunk)
  })

  it.each([
    'git push',
    'git push -u origin HEAD',
    `git push -u origin ${FEATURE}`,
    'git push --force-with-lease origin HEAD',
    'git push origin main:feature/5-x',
    'git push origin --tags',
  ])('passes %s from a branch of the issue', (text) => {
    expect(verdict(text, onFeature.dir).decision).toBe('pass')
  })

  it('asks, critical, when a destination cannot be read', () => {
    expect(verdict('git push origin "$BRANCH"', onFeature.dir)).toMatchObject({
      decision: 'ask',
      critical: true,
    })
  })

  it('passes a push to main of another repository', () => {
    expect(verdict('git push origin main', elsewhere.dir).decision).toBe('pass')
  })
})

describe('what the rules leave alone', () => {
  it.each([
    'git log --oneline',
    'git status',
    'git diff main...HEAD',
    'git fetch origin',
    'git checkout -b feature/9-x',
    "git config alias.ci '!gh issue edit'",
  ])('%s passes without looking the repository up', (text) => {
    const { decision, asked } = judge(text, onMain.dir)
    expect(decision.decision).toBe('pass')
    expect(asked).toEqual([])
  })

  it('asks, critical, for a commit or a push in a directory it cannot read', () => {
    expect(verdict('git -C "$WT" commit -m x', onFeature.dir)).toMatchObject({
      decision: 'ask',
      critical: true,
    })
    const [command] = shell.parseCommand('git push').commands
    expect(
      git.gitDecision(command, {
        cwd: onFeature.dir,
        repoAt: () => null,
        cwdKnown: false,
      }).decision,
    ).toBe('ask')
    expect(verdict('git -C "$WT" log', onFeature.dir).decision).toBe('pass')
  })

  it('asks, critical, when the subcommand cannot be read', () => {
    expect(verdict('git "$SUB" -m x', onMain.dir)).toMatchObject({
      decision: 'ask',
      critical: true,
    })
  })
})

describe('skipTokenIn', () => {
  it('finds each token and the trailer, and nothing else', () => {
    for (const token of skipCiTokens)
      expect(git.skipTokenIn(`a ${token} b`)).toBe(token)
    expect(git.skipTokenIn('x\n\n\nSKIP-CHECKS:  TRUE')).toBe(skipChecksTrailer)
    expect(git.skipTokenIn('skip ci, sem colchetes')).toBeNull()
    expect(git.skipTokenIn(null)).toBeNull()
  })
})

describe('git reads more than its argv (review of #5)', () => {
  it.each([
    [
      'a -c alias of push',
      'git -c alias.p=push p origin HEAD:main',
      onFeatureDir,
    ],
    ['a -c alias of commit', 'git -c alias.ci=commit ci -m x', onMainDir],
    [
      'an alias spelled in capitals',
      'git -c Alias.CI=commit ci -m x',
      onMainDir,
    ],
    ['an alias in the repository config', 'git ci -m x', aliasedDir],
    ['an alias of an alias', 'git chain -m x', aliasedDir],
  ])('denies %s', (_, text, dir) => {
    const decision = verdict(text, dir())
    expect(decision.decision).toBe('deny')
    expect(decision.reason).toMatch(/^o alias \w+ do git é/)
  })

  it('reads an alias an earlier command of the line set', () => {
    expect(
      verdict('git ci -m x', onMain.dir, {
        lineConfig: [{ pair: 'alias.ci=commit', known: true }],
      }).decision,
    ).toBe('deny')
    expect(
      verdict('git ci -m x', onMain.dir, {
        lineConfig: [{ pair: 'alias.ci=$X', known: false }],
      }),
    ).toMatchObject({ decision: 'ask', reason: /não consegui ler o alias ci/ })
  })

  it.each([
    ['a shell alias', 'git sh', /roda um comando de shell/],
    [
      'an alias it cannot read',
      'git -c alias.p="$X" p origin main',
      /não consegui ler o alias p/,
    ],
    ['an alias that loops', 'git loop', /aliases demais/],
  ])('asks, critical, for %s', (_, text, reason) => {
    expect(verdict(text, aliased.dir)).toMatchObject({
      decision: 'ask',
      critical: true,
      reason,
    })
  })

  it('passes an alias of a command it leaves alone, and a word that is no alias', () => {
    expect(verdict('git -c alias.st=status st', onMain.dir).decision).toBe(
      'pass',
    )
    expect(verdict('git nada', onMain.dir).decision).toBe('pass')
  })

  it.each([
    [
      '--attr-source before a push',
      'git --attr-source HEAD push origin HEAD:main',
      onFeatureDir,
      'deny',
    ],
    [
      '--attr-source before a commit',
      'git --attr-source HEAD commit -m x',
      onMainDir,
      'deny',
    ],
    [
      '--attr-source= before a commit',
      'git --attr-source=HEAD commit -m x',
      onMainDir,
      'deny',
    ],
    [
      'an option it does not know, then a push',
      'git --opcao-nova HEAD push origin HEAD:main',
      onFeatureDir,
      'ask',
    ],
  ])('reads the subcommand after %s', (_, text, dir, decision) => {
    expect(verdict(text, dir()).decision).toBe(decision)
  })

  it.each([
    'git push origin :',
    'git push origin +:',
    'git push --branches origin',
    'git push --branch origin',
  ])('denies %s, which pushes main among the branches', (text) => {
    expect(verdict(text, onFeature.dir).reason).toMatch(pushTrunk)
  })

  it.each([
    [
      'remote.<r>.push',
      'git -c remote.origin.push=HEAD:refs/heads/main push origin',
    ],
    ['push.default=matching', 'git -c push.default=matching push origin'],
    [
      'push.default=upstream to main',
      `git -c push.default=upstream -c branch.${FEATURE}.merge=refs/heads/main push`,
    ],
    ['a mirror remote', 'git -c remote.origin.mirror=true push'],
    ['config an earlier command set', 'git push'],
  ])('denies a push with no refspec sent to main by %s', (label, text) => {
    const lineConfig =
      label === 'config an earlier command set'
        ? [{ pair: 'push.default=matching', known: true }]
        : undefined
    expect(verdict(text, onFeature.dir, { lineConfig }).reason).toMatch(
      pushTrunk,
    )
  })

  it.each([
    'git -c push.default=upstream push',
    'git -c push.default=nothing push',
    'git -c push.default=current push origin',
  ])('passes %s from a branch of the issue', (text) => {
    expect(verdict(text, onFeature.dir).decision).toBe('pass')
  })

  it('asks, critical, when the config that decides the push cannot be read', () => {
    expect(
      verdict('git -c push.default="$M" push', onFeature.dir),
    ).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: /configuração que decide o destino do push/,
    })
    expect(
      verdict('git -c push.default=estranho push', onFeature.dir),
    ).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: /push.default=estranho/,
    })
  })

  it('judges a push by the repository it lands in', () => {
    expect(verdict('git push upstream HEAD:main', fork.dir).reason).toMatch(
      pushTrunk,
    )
    expect(verdict('git push origin HEAD:main', fork.dir).decision).toBe('pass')
    expect(
      verdict(`git push ${PROJECT_URL} HEAD:main`, elsewhere.dir).reason,
    ).toMatch(pushTrunk)
    expect(
      verdict('git -c remote.pushDefault=upstream push --all', fork.dir).reason,
    ).toMatch(pushTrunk)
    expect(verdict('git push "$R" HEAD:main', elsewhere.dir).decision).toBe(
      'deny',
    )
  })

  it('reads the repository --git-dir or GIT_DIR names', () => {
    const mainGit = path.join(onMain.dir, '.git')
    expect(
      verdict(
        `git --git-dir=${mainGit} --work-tree=${onMain.dir} commit -m x`,
        onFeature.dir,
      ).reason,
    ).toBe(onTrunk)
    expect(
      verdict(`git --git-dir ${mainGit} commit -m x`, onFeature.dir).reason,
    ).toBe(onTrunk)
    expect(
      verdict(`GIT_DIR=${mainGit} git commit -m x`, onFeature.dir).reason,
    ).toBe(onTrunk)
    expect(
      verdict('git commit -m x', onFeature.dir, { env: { GIT_DIR: mainGit } })
        .reason,
    ).toBe(onTrunk)
    expect(
      verdict('git --git-dir="$D" commit -m x', onFeature.dir),
    ).toMatchObject({
      decision: 'ask',
      reason: /diretório em que o git commit roda/,
    })
  })

  it('asks for a commit in a directory that does not exist yet', () => {
    expect(
      verdict('git -C nao-existe commit -m x', onFeature.dir),
    ).toMatchObject({
      decision: 'ask',
      reason: /diretório em que o git commit roda/,
    })
  })

  it.each([
    ['--trailer with a colon', "--trailer 'skip-checks: true'"],
    ['--trailer= with an equals sign', '--trailer=skip-checks=true'],
  ])('denies the skip trailer given as %s', (_, args) => {
    expect(verdict(`git commit -m x ${args}`, onFeature.dir).reason).toContain(
      skipChecksTrailer,
    )
  })

  it('passes an ordinary trailer', () => {
    expect(
      verdict("git commit -m x --trailer 'Refs: #5'", onFeature.dir).decision,
    ).toBe('pass')
  })

  it('reads -F as an earlier command of the line left it', () => {
    const files = (file: string) =>
      file === path.join(onFeature.dir, 'msg.txt')
        ? { known: true, text: 'x\n\n[skip ci]\n' }
        : undefined
    expect(
      verdict('git commit -F msg.txt', onFeature.dir, { files }).reason,
    ).toMatch(/\[skip ci\]/)
  })
})

describe('a HEAD an earlier command of the line moved (review of #5)', () => {
  const moved =
    (branch: string | null, known = true) =>
    (repo: RepoInfo): SeenRepo => ({ ...repo, branch, branchKnown: known })

  it('denies a commit or a push once the line is on main', () => {
    const seen = moved('main')
    expect(verdict('git commit -am x', onFeature.dir, { seen }).reason).toBe(
      onTrunk,
    )
    expect(verdict('git push', onFeature.dir, { seen }).reason).toMatch(
      pushTrunk,
    )
    expect(
      verdict('git push origin HEAD', onFeature.dir, { seen }).reason,
    ).toMatch(pushTrunk)
  })

  it('asks, critical, when the branch it moved to cannot be told', () => {
    const seen = moved(null, false)
    for (const text of [
      'git commit -m x',
      'git push',
      'git push origin HEAD',
      'git push origin @',
    ])
      expect(verdict(text, onFeature.dir, { seen })).toMatchObject({
        decision: 'ask',
        critical: true,
        reason: /um comando anterior da linha muda o HEAD/,
      })
    expect(
      verdict(`git push origin HEAD:${FEATURE}`, onFeature.dir, { seen })
        .decision,
    ).toBe('pass')
  })

  it.each([
    ['git checkout main', 'main'],
    ['git checkout -q refs/heads/main', 'main'],
    ['git checkout -b feature/9-x origin/main', 'feature/9-x'],
    ['git checkout -B feature/9-x', 'feature/9-x'],
    ['git checkout --orphan novo', 'novo'],
    ['git checkout -t origin/main', 'main'],
    ['git checkout --track origin/feature/9-x', 'feature/9-x'],
    ['git checkout feature/9-x', 'feature/9-x'],
    ['git switch main', 'main'],
    ['git switch -c feature/9-x', 'feature/9-x'],
    ['git switch --create=feature/9-x', 'feature/9-x'],
    ['git rebase origin/main main', 'main'],
    ['git rebase --root main', 'main'],
    ['git branch -m main', 'main'],
    ['git branch -M feature/9-x', 'feature/9-x'],
    ['git symbolic-ref HEAD refs/heads/main', 'main'],
    ['git stash branch feature/9-x', 'feature/9-x'],
    ['git -c alias.co=checkout co main', 'main'],
  ])('%s checks out %s', (text, branch) => {
    const change = git.headChangeOf(commandOf(text), ctxAt(onFeature.dir))
    expect(change).toMatchObject({
      dirKnown: true,
      head: { known: true, branch },
    })
    expect(change?.dir).toBe(onFeature.dir)
  })

  it.each([
    ['git checkout --detach', { known: true, branch: null }],
    ['git switch -d HEAD~1', { known: true, branch: null }],
    ['git checkout -', { known: false, branch: null }],
    ['git checkout @{-1}', { known: false, branch: null }],
    ['git checkout "$B"', { known: false, branch: null }],
    ['git branch -m velho novo', { known: false, branch: null }],
    ['git rebase --continue', { known: false, branch: null }],
    ['git bisect start', { known: false, branch: null }],
    ['git symbolic-ref --delete HEAD', { known: false, branch: null }],
  ])('%s leaves HEAD at %o', (text, head) => {
    expect(
      git.headChangeOf(commandOf(text), ctxAt(onFeature.dir))?.head,
    ).toEqual(head)
  })

  it.each([
    'git checkout README.md',
    'git checkout main -- README.md',
    'git checkout -- README.md',
    'git checkout HEAD',
    'git checkout -p',
    'git reset --hard main',
    'git branch -D velho',
    'git bisect log',
    'git worktree add ../novo main',
    'git commit -m x',
    'git status',
  ])('%s moves no HEAD', (text) => {
    expect(git.headChangeOf(commandOf(text), ctxAt(onFeature.dir))).toBeNull()
  })

  it('names the repository -C and --git-dir point at, and a directory it cannot read', () => {
    expect(
      git.headChangeOf(
        commandOf(`git -C ${onMain.dir} switch main`),
        ctxAt(onFeature.dir),
      )?.dir,
    ).toBe(onMain.dir)
    expect(
      git.headChangeOf(
        commandOf('git -C "$D" switch main'),
        ctxAt(onFeature.dir),
      )?.dirKnown,
    ).toBe(false)
    expect(
      git.headChangeOf(commandOf('git switch main'), {
        ...ctxAt(onFeature.dir),
        cwdKnown: false,
      })?.dirKnown,
    ).toBe(false)
  })
})

describe('what a git command leaves for the rest of the line', () => {
  it.each([
    ['git config alias.ci commit', [{ pair: 'alias.ci=commit', known: true }]],
    [
      'git config --global push.default matching',
      [{ pair: 'push.default=matching', known: true }],
    ],
    [
      'git config set --local alias.p push',
      [{ pair: 'alias.p=push', known: true }],
    ],
    [
      'git config --file x.cfg alias.p push',
      [{ pair: 'alias.p=push', known: true }],
    ],
    ['git config user.email "$E"', [{ pair: 'user.email=$E', known: false }]],
    [
      `git remote add up ${PROJECT_URL}`,
      [{ pair: `remote.up.url=${PROJECT_URL}`, known: true }],
    ],
    [
      `git remote set-url --push origin ${PROJECT_URL}`,
      [{ pair: `remote.origin.pushurl=${PROJECT_URL}`, known: true }],
    ],
    ['git config --get alias.ci', []],
    ['git config --unset alias.ci', []],
    ['git config alias.ci', []],
    ['git remote -v', []],
    ['git remote set-url --delete origin x', []],
    ['git status', []],
  ])('%s sets %o', (text, pairs) => {
    expect(git.configSetBy(commandOf(text), ctxAt(onFeature.dir))).toEqual(
      pairs,
    )
  })

  it.each([
    ['git config alias.x commit', true],
    ['git -c alias.x=push x', true],
    ['git config --global alias.x "!gh issue edit"', true],
    ["git commit -m 'alias.x e ready-for-agent'", false],
    ['git config user.name x', false],
  ])('%s defines an alias: %s', (text, expected) => {
    expect(git.definesAlias(commandOf(text), ctxAt(onFeature.dir))).toBe(
      expected,
    )
  })

  describe('the remotes gh picks its repository from (Copilot review of #26)', () => {
    const OTHER_URL = 'https://github.com/alguem/outro.git'
    const change = (text: string, cwd = onFeature.dir) =>
      git.remoteChangeOf(commandOf(text), ctxAt(cwd))

    it.each([
      `git remote set-url origin ${PROJECT_URL}`,
      `git remote add origin ${PROJECT_URL}`,
      `git remote add -t main -m main origin ${PROJECT_URL}`,
      `git config remote.origin.url ${PROJECT_URL}`,
      `git config --local Remote.origin.URL ${PROJECT_URL}`,
      `git config set remote.origin.url ${PROJECT_URL}`,
    ])('follows %s as a new URL for origin', (text) => {
      expect(change(text)).toEqual({
        dir: onFeature.dir,
        dirKnown: true,
        everywhere: false,
        origin: { known: true, url: PROJECT_URL },
      })
    })

    it('keeps a URL it cannot read as unknown', () => {
      expect(change('git remote set-url origin "$URL"')).toMatchObject({
        origin: { known: false },
      })
    })

    it.each([
      `git remote add upstream ${PROJECT_URL}`,
      `git remote set-url --push origin ${PROJECT_URL}`,
      `git remote set-url --add origin ${PROJECT_URL}`,
      `git remote set-url origin ${PROJECT_URL} ${OTHER_URL}`,
      'git remote rename origin velho',
      'git remote remove origin',
      'git remote "$VERBO" origin',
      'git config --unset remote.origin.url',
      `git config --add remote.origin.url ${PROJECT_URL}`,
      `git config remote.Origin.url ${PROJECT_URL}`,
      `git config remote.origin.pushurl ${PROJECT_URL}`,
      'git config --remove-section remote.origin',
      'git config rename-section remote.origin remote.velho',
      `git config "$CHAVE" ${PROJECT_URL}`,
      'git config --edit',
      'git config include.path ../outro.cfg',
    ])('reads %s as a change it does not follow', (text) => {
      expect(change(text)).toEqual({
        dir: onFeature.dir,
        dirKnown: true,
        everywhere: false,
        origin: null,
      })
    })

    it.each([
      `git config --global url.${PROJECT_URL}.insteadOf ${OTHER_URL}`,
      'git config --system remote.origin.url x',
      `git config --file .git/config remote.origin.url ${PROJECT_URL}`,
    ])('reads %s as a change every repository sees', (text) => {
      expect(change(text)).toMatchObject({ everywhere: true })
    })

    it('lands where -C points, in a place not known when -C cannot be read', () => {
      expect(
        change(`git -C ${onMain.dir} remote set-url origin ${OTHER_URL}`),
      ).toMatchObject({ dir: onMain.dir, dirKnown: true })
      expect(
        change(`git -C "$REPO" remote set-url origin ${OTHER_URL}`),
      ).toMatchObject({ dirKnown: false })
    })

    it('counts a subcommand it cannot read as a change anywhere', () => {
      expect(change('git "$SUB" origin x')).toMatchObject({
        everywhere: true,
        origin: null,
      })
    })

    it.each([
      'git remote -v',
      'git remote get-url origin',
      'git remote show origin',
      'git config --get remote.origin.url',
      'git config remote.origin.url',
      'git config get remote.origin.url',
      'git config --list',
      'git config user.name x',
      'git config --global alias.ci commit',
      'git status',
      'git fetch origin',
    ])('reads no change in %s', (text) => {
      expect(change(text)).toBeNull()
    })
  })

  it('reads a file through the override first, stdin included', () => {
    const files = (file: string) =>
      file === '/x/escrito.md' ? { known: true, text: 'da linha' } : undefined
    expect(
      git.readSource({ argv: [] }, '/x', 'escrito.md', true, files),
    ).toEqual({
      known: true,
      text: 'da linha',
    })
    expect(
      git.readSource(
        { argv: [], stdinFile: 'escrito.md' },
        '/x',
        '-',
        true,
        files,
      ),
    ).toEqual({ known: true, text: 'da linha' })
    expect(
      git.readSource({ argv: [] }, '/x', 'escrito.md', false, files),
    ).toEqual({
      known: false,
      text: null,
    })
  })
})

function onFeatureDir(): string {
  return onFeature.dir
}
function onMainDir(): string {
  return onMain.dir
}
function aliasedDir(): string {
  return aliased.dir
}

// ---------------------------------------------------------------------------
// Third round of Copilot's review of #26

describe('a commit message it cannot read (Copilot review of #26, third round)', () => {
  it.each([
    ['git commit -m "$MSG"', 'a mensagem do commit'],
    ['git merge -F "$FILE" origin/main', 'a mensagem do merge'],
    ['printf "Hooks\\n" | git commit -F -', 'a mensagem do commit'],
    ['git commit -F /nao/existe.txt', 'a mensagem do commit'],
  ])('asks, critical, for %s', (text, what) => {
    expect(verdict(text, onFeature.dir)).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: expect.stringContaining(`não consegui ler ${what}`) as string,
    })
  })

  it('still denies a skip string it can read next to a part it cannot', () => {
    expect(
      verdict('git commit -m "$MSG" -m "[skip ci]"', onFeature.dir).decision,
    ).toBe('deny')
  })

  describe('the forms a session writes stay readable', () => {
    it.each([
      [
        '-F - with a heredoc',
        "git commit -F - <<'MSG'\nHooks do loop.\n\nRefs #5\nMSG",
      ],
      [
        '-m "$(cat <<\'EOF\' … EOF)"',
        `git commit -m "$(cat <<'EOF'\nHooks do loop.\n\nRefs #5\nEOF\n)"`,
      ],
      [
        'the same with an unquoted delimiter and no expansion',
        `git commit -m "$(cat <<EOF\nHooks do loop.\nEOF\n)"`,
      ],
      [
        'a variable the line assigned',
        'M=\'Hooks do loop. Refs #5\'; git commit -m "$M"',
      ],
      [
        'a variable the line assigned from "$(cat <<\'EOF\' … EOF)"',
        `M="$(cat <<'EOF'\nHooks do loop.\nEOF\n)"; git commit -m "$M"`,
      ],
      ['-F with a file that is there', 'git commit -F msg-ok.txt'],
    ])('passes %s', (_, text) => {
      onFeature.write({ 'msg-ok.txt': 'Hooks\n' })
      expect(verdict(text, onFeature.dir)).toEqual({ decision: 'pass' })
    })

    it.each([
      [
        '-m "$(cat <<\'EOF\' … EOF)"',
        `git commit -m "$(cat <<'EOF'\nHooks\n\n[skip ci]\nEOF\n)"`,
      ],
      [
        'a variable the line assigned from it',
        `M="$(cat <<'EOF'\nHooks [ci skip]\nEOF\n)"; git commit -m "$M"`,
      ],
    ])('denies a skip string in %s', (_, text) => {
      expect(verdict(text, onFeature.dir).decision).toBe('deny')
    })

    it('does not read "$(cat …)" after the line defines a function', () => {
      expect(
        verdict(
          `cat() { printf '[skip ci]'; }; git commit -m "$(cat <<'EOF'\nHooks\nEOF\n)"`,
          onFeature.dir,
        ),
      ).toMatchObject({ decision: 'ask', critical: true })
    })
  })
})

describe('git push --repo (Copilot review of #26, third round)', () => {
  it.each([
    `git push --repo ${PROJECT_URL} HEAD:main`,
    `git push --repo=${PROJECT_URL} HEAD:main`,
    'git push --repo origin main',
    'git push --repo=origin +HEAD:refs/heads/main',
    'git push --repo origin feature/5-x:main feature/5-x',
    'git push --repo "$REMOTE" HEAD:main',
  ])('denies %s from a branch of the issue', (text) => {
    const decision = verdict(text, onFeature.dir)
    expect(decision.decision).toBe('deny')
    expect(decision.reason).toMatch(pushTrunk)
  })

  it('keeps git’s own reading: the repository on the line wins over --repo', () => {
    expect(
      verdict(
        `git push --repo=https://github.com/alguem/outro.git ${PROJECT_URL} HEAD:main`,
        onFeature.dir,
      ).reason,
    ).toMatch(pushTrunk)
  })

  it.each([
    'git push --repo origin',
    `git push --repo=${PROJECT_URL}`,
    `git push --repo origin ${FEATURE}`,
    `git push --repo=origin HEAD:${FEATURE}`,
    'git push --repo https://github.com/alguem/outro.git HEAD:main',
  ])('passes %s', (text) => {
    expect(verdict(text, onFeature.dir).decision).toBe('pass')
  })
})

describe('the editor a commit opens for its message (Copilot review of #26, third round)', () => {
  const editor = /o git (?:commit|merge|revert) abre um editor para a mensagem/

  it.each([
    ['a commit with no message on the line', 'git commit -a'],
    ['an amend that keeps the editor', 'git commit --amend'],
    ['-e next to -m', 'git commit -m x -e'],
    ['--edit after --no-edit', 'git commit --no-edit --edit -m x'],
    ['-c, which reedits a message', 'git commit -c HEAD'],
    ['--squash alone', 'git commit --squash HEAD'],
    ['--fixup=reword:', 'git commit --fixup=reword:HEAD'],
    ['-t, a template to edit', 'git commit -t modelo.txt'],
    ['git merge -e', 'git merge -e origin/main'],
    [
      'git merge with GIT_MERGE_AUTOEDIT=yes',
      'GIT_MERGE_AUTOEDIT=yes git merge x',
    ],
    ['git merge --continue, which runs git commit', 'git merge --continue'],
    ['git revert -e', 'git revert -e HEAD'],
    ['an editor it cannot read', 'GIT_EDITOR="$E" git commit --amend'],
    ['an editor that writes', `GIT_EDITOR='sed -i s/^/x/' git commit --amend`],
    ['core.editor that writes', 'git -c core.editor=vim commit --amend'],
  ])('asks, critical, for %s', (_, text) => {
    expect(verdict(text, onFeature.dir)).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: expect.stringMatching(editor) as string,
    })
  })

  it.each([
    ['a message on the line', 'git commit -m x'],
    ['--amend --no-edit', 'git commit --amend --no-edit'],
    ['a plain --fixup', 'git commit --fixup HEAD'],
    ['--squash with -m', 'git commit --squash HEAD -m x'],
    ['-C, which reuses a message as it is', 'git commit -C HEAD'],
    ['GIT_EDITOR=true', 'GIT_EDITOR=true git commit --amend'],
    ['GIT_EDITOR=:', 'GIT_EDITOR=: git commit -a'],
    ['core.editor=true', 'git -c core.editor=true commit --amend'],
    ['a merge with no terminal', 'git merge origin/main'],
    ['a merge --abort', 'git merge --abort'],
    ['a revert with no terminal', 'git revert --no-edit HEAD'],
  ])('passes %s', (_, text) => {
    expect(verdict(text, onFeature.dir)).toEqual({ decision: 'pass' })
  })

  it('reads GIT_EDITOR the session exports', () => {
    expect(
      verdict('git commit --amend', onFeature.dir, {
        env: { GIT_EDITOR: 'true' },
      }),
    ).toEqual({ decision: 'pass' })
  })
})

describe('a word git does not know in the subcommand’s place (Copilot review of #26, third round)', () => {
  it('asks, critical, when the command names a commit or a push after it', () => {
    expect(verdict('git valor push', onFeature.dir)).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: /não reconheci "valor" como subcomando nem alias do git/,
    })
    expect(verdict('git valor status', onFeature.dir).decision).toBe('pass')
  })

  it('asks, critical, when the command names a write to the worktree after it (fourth round)', () => {
    expect(verdict('git valor restore README.md', onFeature.dir)).toMatchObject(
      {
        decision: 'ask',
        critical: true,
        reason: /não reconheci "valor" .* e o comando cita restore/,
      },
    )
  })
})

// ---------------------------------------------------------------------------
// Fourth round of Copilot's review of #26

describe('git writes to the worktree go through the gate (Copilot review of #26, fourth round)', () => {
  /**
   * Branches of the issue whose gate is closed, open, never run, open but
   * unverified, open with a plan of this session not yet posted; and a
   * detached HEAD. The commands are judged, not run: only the reads the rule
   * makes (is this word a branch or a file?) touch the repositories.
   */
  const SESSION = 'sessao-das-escritas'
  let closed: HookRepo
  let open: HookRepo
  let missing: HookRepo
  let unverified: HookRepo
  let pending: HookRepo
  let detached: HookRepo

  beforeAll(async () => {
    ;[closed, open, missing, unverified, pending, detached] = await Promise.all(
      [
        hookRepo({ branch: FEATURE, cache: { open: false } }),
        hookRepo({ branch: FEATURE, cache: true }),
        hookRepo({ branch: FEATURE }),
        hookRepo({ branch: FEATURE, cache: { verified: false } }),
        hookRepo({ branch: FEATURE, cache: true, marker: SESSION }),
        hookRepo({ detached: true }),
      ],
    )
    // A tracked file deleted from the disk, which `git checkout <file>`
    // brings back; a remote branch `git checkout <name>` would create a
    // branch from; the lists --pathspec-from-file reads.
    await closed.commit({ 'apagado.md': 'x\n' }, 'Apagado')
    rmSync(path.join(closed.dir, 'apagado.md'))
    // Logs are ignored, but for one the .gitignore keeps; an ignored file
    // in a folder whose name holds a wildcard.
    closed.write({
      '.gitignore': '*.log\n!importante.log\n',
      'importante.log': 'x\n',
      'logs[1]/a.log': 'x\n',
    })
    await closed.git(
      'update-ref',
      'refs/remotes/origin/feature/9-remota',
      'HEAD',
    )
    closed.write({
      'context/intent/feature-x.md': '# Intent\n',
      'lista-intent.txt': 'context/intent/feature-x.md\n',
      'lista-readme.txt': 'README.md\n',
    })
  }, setupTimeout)

  afterAll(() => {
    for (const repo of [closed, open, missing, unverified, pending, detached])
      repo?.remove()
  }, setupTimeout)

  /** The decision in a mode, as guard-bash resolves it, for this session. */
  const write = (text: string, repo: HookRepo, mode = 'default') =>
    io.resolve(
      verdict(text, repo.dir, {
        input: { session_id: SESSION, cwd: repo.dir },
      }),
      mode,
    )

  const closedGate = /o gate está fechado: rode npm run gate/
  const autoDeny = /Em auto, a confirmação vira negação/

  it('refuses the probe Copilot ran: git checkout -- README.md on a branch of the issue with the gate closed', () => {
    for (const mode of ['default', 'auto']) {
      const decision = write('git checkout -- README.md', closed, mode)
      expect(decision.decision).toBe('deny')
      expect(decision.reason).toMatch(/o git checkout escreve no worktree/)
      expect(decision.reason).toMatch(closedGate)
    }
  })

  const families: [string, string][] = [
    ['checkout of a path from the index', 'git checkout -- README.md'],
    ['checkout of a path from a commit', 'git checkout main -- README.md'],
    ['checkout of a path from a commit, no --', 'git checkout main README.md'],
    ['checkout of a file, no --', 'git checkout README.md'],
    ['checkout of a deleted file, no --', 'git checkout apagado.md'],
    ['checkout --ours of a path', 'git checkout --ours -- README.md'],
    ['checkout -p', 'git checkout -p'],
    ['checkout -f with no branch', 'git checkout -f'],
    ['restore', 'git restore README.md'],
    ['restore --staged', 'git restore --staged README.md'],
    ['restore --source', 'git restore -s main -- README.md'],
    ['restore of the whole tree', 'git restore .'],
    ['reset --hard', 'git reset --hard'],
    ['reset --merge', 'git reset --merge HEAD'],
    ['reset --keep', 'git reset --keep main'],
    ['reset of a path', 'git reset -- README.md'],
    ['reset of a path from a commit', 'git reset main README.md'],
    ['apply', 'git apply correcao.patch'],
    ['apply --cached', 'git apply --cached correcao.patch'],
    ['apply --index -3', 'git apply --index -3 correcao.patch'],
    ['apply --check --apply', 'git apply --check --apply correcao.patch'],
    ['am', 'git am --continue'],
    ['cherry-pick', 'git cherry-pick main'],
    ['cherry-pick -n', 'git cherry-pick -n main'],
    ['revert', 'git revert --no-edit HEAD'],
    ['merge', 'git merge main'],
    ['merge --squash', 'git merge --squash main'],
    [
      'merge --ff-only of a branch other than main',
      'git merge --ff-only feature/9-x',
    ],
    [
      'merge --ff-only undone by --no-ff',
      'git merge --ff-only --no-ff origin/main',
    ],
    ['pull', 'git pull'],
    ['pull --rebase', 'git pull --rebase origin main'],
    ['rebase', 'git rebase main'],
    ['rebase --continue', 'git rebase --continue'],
    ['stash apply', 'git stash apply'],
    ['stash pop', 'git stash pop stash@{0}'],
    ['stash branch', 'git stash branch feature/9-x'],
    ['rm', 'git rm README.md'],
    ['rm --cached', 'git rm --cached README.md'],
    ['mv', 'git mv README.md LEIA.md'],
    ['clean -f', 'git clean -fd'],
    ['clean -x', 'git clean -f -x -- src'],
    ['read-tree -u', 'git read-tree -u -m HEAD'],
    ['checkout-index -a', 'git checkout-index -a -f'],
    ['checkout-index of a path', 'git checkout-index -f -- README.md'],
    ['update-index', 'git update-index --chmod=+x README.md'],
    ['sparse-checkout set', 'git sparse-checkout set src'],
    ['mergetool', 'git mergetool README.md'],
    ['merge-file', 'git merge-file README.md base.md outro.md'],
    ['lfs pull', 'git lfs pull'],
    ['filter-branch', 'git filter-branch --tree-filter true HEAD'],
    ['a write behind -C', `git -C ${'.'} restore README.md`],
    ['a write after cd', 'cd . && git restore README.md'],
  ]

  it.each(families)(
    'denies %s with the gate closed, in default and in auto',
    (_, text) => {
      for (const mode of ['default', 'auto']) {
        const decision = write(text, closed, mode)
        expect(decision.decision).toBe('deny')
        expect(decision.reason).toMatch(closedGate)
      }
    },
  )

  // git clean -x and -X remove ignored files, the owner's emergency exit
  // among them (Copilot review of #45): a clean that holds it is denied even
  // with the gate open, and one of another folder is judged as before.
  it.each([
    'git clean -fdx',
    'git clean -fdX',
    'git clean -f -x .',
    'git clean -fx -- .claude',
    'git clean -fdx :/',
  ])(
    'denies %s with the gate open: it removes .claude/settings.local.json',
    (text) => {
      for (const mode of ['default', 'auto']) {
        const decision = write(text, open, mode)
        expect(decision.decision, mode).toBe('deny')
        expect(decision.reason, mode).toMatch(/a saída de emergência é do dono/)
      }
    },
  )

  // A folder named as a pathspec covers the harness files under it (Copilot
  // review of #45): they ask as they would by name.
  it.each([
    'git restore scripts',
    'git restore scripts/',
    'git checkout main -- scripts',
    'git restore -- .github',
  ])(
    'asks, critical, for %s with the gate open: the folder holds harness files',
    (text) => {
      expect(write(text, open)).toMatchObject({
        decision: 'ask',
        critical: true,
        reason: expect.stringMatching(/caminho do harness/) as string,
      })
      expect(write(text, open, 'auto').decision).toBe('deny')
    },
  )

  it.each(['git restore src', 'git checkout main -- src', 'git restore .'])(
    'lets %s through with the gate open: no harness file is named under it',
    (text) => {
      expect(write(text, open).decision).toBe('pass')
    },
  )

  it.each(['git clean -fd', 'git clean -f -x -- src', 'git clean -fdx src/'])(
    'lets %s through with the gate open',
    (text) => {
      expect(write(text, open).decision).toBe('pass')
    },
  )

  it.each([
    'git checkout -- README.md',
    'git restore .',
    'git merge main',
    'git stash pop',
    'git rm README.md',
    'git clean -fd',
  ])(
    'asks, critical, for %s with a plan of this session not yet posted: an ask in default, a deny in auto',
    (text) => {
      expect(write(text, pending)).toMatchObject({
        decision: 'ask',
        critical: true,
        reason: expect.stringMatching(/plano aceito nesta sessão/) as string,
      })
      const auto = write(text, pending, 'auto')
      expect(auto.decision).toBe('deny')
      expect(auto.reason).toMatch(autoDeny)
    },
  )

  it('gives the other states of the gate the decision build-guard gives an edit', () => {
    expect(write('git restore README.md', missing).reason).toMatch(
      /o gate ainda não rodou neste worktree/,
    )
    expect(write('git restore README.md', unverified)).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: expect.stringMatching(/o gate abriu sem ler a issue/) as string,
    })
    expect(write('git restore README.md', unverified, 'auto').decision).toBe(
      'deny',
    )
    for (const mode of ['default', 'auto']) {
      expect(write('git checkout -- README.md', onMain, mode)).toMatchObject({
        decision: 'deny',
        reason: expect.stringMatching(/em main, nada se edita/) as string,
      })
      expect(write('git merge main', detached, mode)).toMatchObject({
        decision: 'deny',
        reason: expect.stringMatching(/HEAD destacado/) as string,
      })
    }
  })

  it.each([
    'git checkout -- README.md',
    'git restore .',
    'git reset --hard',
    'git merge main',
    'git pull',
    'git stash pop',
    'git rm README.md',
  ])('passes %s with the gate open', (text) => {
    for (const mode of ['default', 'auto'])
      expect(write(text, open, mode)).toEqual({ decision: 'pass' })
  })

  it('asks, critical, for a path of the harness even with the gate open, and refuses the owner’s exit', () => {
    expect(
      write('git checkout main -- .claude/settings.json', open),
    ).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: expect.stringMatching(
        /caminho do harness \(\.claude\/settings\.json\)/,
      ) as string,
    })
    expect(
      write('git checkout main -- .claude/settings.json', open, 'auto')
        .decision,
    ).toBe('deny')
    expect(
      write('git checkout main -- .claude/settings.local.json', open),
    ).toMatchObject({
      decision: 'deny',
      reason: expect.stringMatching(
        /a saída de emergência é do dono/,
      ) as string,
    })
  })

  it.each([
    'git checkout -- context/intent/feature-x.md',
    'git checkout main -- context/intent',
    'git restore context/intent/',
    "git restore -- 'context/intent/*.md'",
    'git rm -r context/intent/velho.md',
    'git reset -- context/intent/feature-x.md',
    'cd context/intent && git restore feature-x.md',
    'git restore --pathspec-from-file=lista-intent.txt',
    // `:/` and `:(top)` read the path from the worktree's top, not from the
    // directory git runs in.
    "cd context && git restore ':/context/intent/feature-x.md'",
    "cd context && git restore ':(top)context/intent/feature-x.md'",
    // An exclude takes a path away from the intent, and adds none.
    "git restore -- context/intent ':!context/intent/feature-x.md'",
    // git drops the folder `..` climbs out of before it matches the glob.
    "git restore -- 'context/intent/*/../feature-x.md'",
  ])('passes %s, which writes only the intent', (text) => {
    for (const mode of ['default', 'auto'])
      expect(write(text, closed, mode)).toEqual({ decision: 'pass' })
  })

  it.each([
    'git checkout -- context/intent/feature-x.md README.md',
    "git restore -- 'context/int*'",
    'git restore --pathspec-from-file=lista-readme.txt',
    'git restore Context/Intent/feature-x.md',
    // Only exclusions: git reads them as everything but those paths.
    "git checkout main -- ':!context/intent/feature-x.md'",
    "git restore -- ':(exclude)context/intent/feature-x.md'",
    // `:/` from inside the intent is the worktree's top.
    "cd context/intent && git restore ':/README.md'",
    "cd context/intent && git restore ':(top)README.md'",
    // git normalizes the `..` first: this is README.md, not the intent.
    "git checkout main -- 'context/intent/*/../../../README.md'",
    "git restore -- 'context/intent/*/../../README.md'",
    // A glob is the folder it may reach, whatever a .gitignore pattern says
    // of its text: `*portante.log` reads as ignored, and git clean would
    // delete importante.log, which the .gitignore keeps.
    "git clean -f -- '*portante.log'",
  ])('denies %s, which writes outside the intent', (text) => {
    expect(write(text, closed).decision).toBe('deny')
  })

  it('reads the directory git runs in as it is written, wildcards and all', () => {
    // git takes the directory it runs in literally, so logs[1]/a.log is one
    // file, which the .gitignore ignores; were the `[` read as a glob, the
    // write would reach the worktree whole.
    for (const mode of ['default', 'auto'])
      expect(write("cd 'logs[1]' && git restore a.log", closed, mode)).toEqual({
        decision: 'pass',
      })
  })

  it.each([
    'git switch -c feature/9-x origin/main',
    'git switch main',
    `git switch ${FEATURE}`,
    'git switch -',
    'git checkout -b feature/9-x',
    'git checkout -b feature/9-x origin/main',
    'git checkout main',
    `git checkout ${FEATURE}`,
    'git checkout feature/9-remota',
    // The branch checked out before, whatever a file named `-` would be.
    'git checkout -',
    'git checkout --detach main',
    'git checkout main --',
    'git fetch origin',
    'git status',
    'git log --oneline',
    'git diff',
    'git show HEAD:README.md',
    'git stash',
    'git stash -u',
    'git stash push -m wip -- README.md',
    'git stash list',
    'git stash show -p',
    'git stash drop',
    'git worktree add ../novo -b feature/9-x origin/main',
    'git clean -n',
    'git clean --dry-run -d',
    'git rm -n README.md',
    'git mv --dry-run README.md LEIA.md',
    'git apply --check correcao.patch',
    'git apply --stat correcao.patch',
    'git pull --dry-run',
    'git read-tree -n HEAD',
    'git merge --abort',
    // Where `git switch -C <branch> origin/main` would leave the worktree.
    'git merge --ff-only origin/main -q',
    'git merge --ff-only main',
    'git rebase --abort',
    'git cherry-pick --quit',
    'git am --abort',
    'git add README.md',
    'git commit -m x',
    'git reset --soft HEAD~1',
    'git reset HEAD~1',
    'git update-index -q --refresh',
    'git sparse-checkout list',
  ])(
    'passes %s with the gate closed: the loop needs it before the gate opens',
    (text) => {
      for (const mode of ['default', 'auto'])
        expect(write(text, closed, mode)).toEqual({ decision: 'pass' })
    },
  )

  it('passes a write in another repository or outside any', () => {
    for (const mode of ['default', 'auto']) {
      expect(write('git checkout -- README.md', elsewhere, mode)).toEqual({
        decision: 'pass',
      })
      expect(
        io.resolve(
          verdict(`git -C ${elsewhere.dir} reset --hard`, closed.dir, {
            input: { session_id: SESSION, cwd: closed.dir },
          }),
          mode,
        ),
      ).toEqual({ decision: 'pass' })
      expect(
        io.resolve(verdict('git restore README.md', outside), mode),
      ).toEqual({ decision: 'pass' })
    }
  })

  it.each([
    ['a path behind an expansion', 'git checkout -- "$F"'],
    ['a word that may be a branch or a file', 'git checkout "$ALVO"'],
    ['a directory behind an expansion', 'git -C "$WT" restore README.md'],
    [
      'a list of paths it cannot read',
      'git restore --pathspec-from-file=nao-existe.txt',
    ],
    ['a list read from a pipe', 'ls | git restore --pathspec-from-file=-'],
    [
      'a work tree named elsewhere',
      'git --work-tree=../outro checkout -- README.md',
    ],
  ])(
    'asks, critical, for %s where the gate is closed: an ask in default, a deny in auto',
    (_, text) => {
      expect(write(text, closed)).toMatchObject({
        decision: 'ask',
        critical: true,
      })
      expect(write(text, closed, 'auto').decision).toBe('deny')
    },
  )

  it('passes a path it cannot read where the gate is open', () => {
    expect(write('git checkout -- "$F"', open)).toEqual({ decision: 'pass' })
  })

  it('asks, critical, when an earlier command of the line moved HEAD', () => {
    const decision = io.resolve(
      verdict('git restore README.md', open.dir, {
        seen: (repo) => ({ ...repo, branchKnown: false }),
        input: { session_id: SESSION, cwd: open.dir },
      }),
      'default',
    )
    expect(decision).toMatchObject({
      decision: 'ask',
      critical: true,
      reason: expect.stringMatching(
        /um comando anterior da linha muda o HEAD/,
      ) as string,
    })
  })

  it('reads a write an alias expands to', () => {
    expect(
      write('git -c alias.desfaz="checkout --" desfaz README.md', closed)
        .decision,
    ).toBe('deny')
  })

  describe('the reads that tell a branch from a file run nothing the command names', () => {
    // Whether the word of `git checkout <word>` or `git reset <word>` is a
    // commit is asked of git. The command's config must not make that read
    // run a program: a promisor remote it names makes git fetch the commit
    // it lacks, through any transport (ext:: runs a program), and
    // core.fsmonitor runs one when git reads the index (`:README.md`). The
    // config comes as -c, or in the environment (GIT_CONFIG_COUNT).
    const missing = '1'.repeat(40)
    const promisor = (marker: string) => [
      'remote.lazy.promisor=true',
      `remote.lazy.url=ext::touch ${marker}`,
      'protocol.ext.allow=always',
    ]
    const asDashC = (pairs: string[]) =>
      pairs.map((pair) => `-c '${pair}'`).join(' ')
    const asEnv = (pairs: string[]) =>
      [
        `GIT_CONFIG_COUNT=${pairs.length}`,
        ...pairs.flatMap((pair, index) => {
          const eq = pair.indexOf('=')
          return [
            `GIT_CONFIG_KEY_${index}=${pair.slice(0, eq)}`,
            `GIT_CONFIG_VALUE_${index}='${pair.slice(eq + 1)}'`,
          ]
        }),
      ].join(' ')
    const fsmonitor = (marker: string) => [`core.fsmonitor=touch ${marker}`]

    const cases: [string, (marker: string) => string][] = [
      [
        'a promisor remote in -c, for checkout',
        (m) => `git ${asDashC(promisor(m))} checkout ${missing}`,
      ],
      [
        'a promisor remote in -c, for reset',
        (m) => `git ${asDashC(promisor(m))} reset ${missing}`,
      ],
      [
        'a promisor remote in the environment, for checkout',
        (m) => `${asEnv(promisor(m))} git checkout ${missing}`,
      ],
      [
        'a promisor remote in the environment, for reset',
        (m) => `${asEnv(promisor(m))} git reset ${missing}`,
      ],
      [
        'core.fsmonitor in -c, for checkout',
        (m) => `git ${asDashC(fsmonitor(m))} checkout :README.md`,
      ],
      [
        'core.fsmonitor in -c, for reset',
        (m) => `git ${asDashC(fsmonitor(m))} reset :README.md`,
      ],
      [
        'core.fsmonitor in the environment, for checkout',
        (m) => `${asEnv(fsmonitor(m))} git checkout :README.md`,
      ],
      [
        'core.fsmonitor in the environment, for reset',
        (m) => `${asEnv(fsmonitor(m))} git reset :README.md`,
      ],
    ]

    it.each(cases)('runs nothing for %s', (name, line) => {
      const marker = path.join(
        closed.root,
        `rodou-${name.replace(/\W+/g, '-')}`,
      )
      const decision = write(line(marker), closed)
      expect(decision.decision).not.toBe('pass')
      expect(existsSync(marker)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Sixth round of Copilot's review of #26

describe('writes to main’s ref (Copilot review of #26, sixth round)', () => {
  /**
   * A branch of the issue with its gate open, one commit ahead of main, a
   * symbolic ref `atalho` that points at main, and a -z batch for
   * update-ref --stdin that moves main.
   */
  let refs: HookRepo
  let mainSha = ''
  let featureSha = ''

  beforeAll(async () => {
    refs = await hookRepo({ branch: FEATURE })
    await refs.git('symbolic-ref', 'refs/heads/atalho', 'refs/heads/main')
    await refs.commit({ 'feature.txt': 'Só na branch.\n' }, 'Feature')
    featureSha = await refs.git('rev-parse', 'HEAD')
    mainSha = await refs.git('rev-parse', 'refs/heads/main')
    refs.headSha = featureSha
    refs.writeCache()
    refs.write({
      'lote-main.bin': `update refs/heads/main\0${featureSha}\0\0`,
      'lote-outra.bin': `update refs/heads/outra\0${featureSha}\0\0`,
      'lote-sem-deref.bin': `option no-deref\0update refs/heads/atalho\0${featureSha}\0\0`,
    })
  }, setupTimeout)

  afterAll(() => refs?.remove(), setupTimeout)

  /** The decision in each permission mode: auto refuses a critical ask. */
  const modes = (decision: Decision) => [
    io.resolve(decision, 'default').decision,
    io.resolve(decision, 'auto').decision,
  ]
  // A push says it as the push rule does.
  const moves = /main fora de uma PR|^push em main: a mudança entra por PR/

  it.each<[string, () => string, () => string]>([
    [
      'update-ref of refs/heads/main (the example of the review)',
      () => `git update-ref refs/heads/main ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref of the short name main',
      () => `git update-ref main ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref of heads/main',
      () => `git update-ref heads/main ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref -d of main',
      () => 'git update-ref -d refs/heads/main',
      () => refs.dir,
    ],
    [
      'update-ref of main in another case, the same file on macOS',
      () => `git update-ref refs/heads/MAIN ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref of main with every word in another case',
      () => `git update-ref Refs/Heads/Main ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref of a symbolic ref that points at main',
      () => `git update-ref refs/heads/atalho ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref of HEAD in the checkout of main',
      () => `git update-ref HEAD ${mainSha}`,
      () => onMain.dir,
    ],
    [
      'update-ref --no-deref of HEAD in the checkout of main',
      () => `git update-ref --no-deref HEAD ${mainSha}`,
      () => onMain.dir,
    ],
    [
      'update-ref of HEAD in the checkout of main, through -C',
      () => `git -C ${onMain.dir} update-ref HEAD ${mainSha}`,
      () => refs.dir,
    ],
    [
      'an update-ref --stdin batch that updates main',
      () =>
        `git update-ref --stdin <<'EOF'\nupdate refs/heads/main ${featureSha}\nEOF`,
      () => refs.dir,
    ],
    [
      'an update-ref --stdin batch that deletes main after another ref',
      () =>
        `git update-ref --stdin <<'EOF'\nstart\ncreate refs/heads/outra ${featureSha}\ndelete refs/heads/main\ncommit\nEOF`,
      () => refs.dir,
    ],
    [
      'an update-ref --stdin batch that names main quoted',
      () =>
        `git update-ref --stdin <<'EOF'\nupdate "refs/heads/main" ${featureSha}\nEOF`,
      () => refs.dir,
    ],
    [
      'an update-ref -z --stdin batch from a file',
      () => 'git update-ref -z --stdin < lote-main.bin',
      () => refs.dir,
    ],
    [
      'an update-ref --stdin batch whose option no-deref ends before its write through the symbolic ref',
      () =>
        `git update-ref --stdin <<'EOF'\noption no-deref\nupdate refs/heads/outra ${featureSha}\nupdate refs/heads/atalho ${featureSha}\nEOF`,
      () => refs.dir,
    ],
    [
      'branch -f main',
      () => `git branch -f main ${featureSha}`,
      () => refs.dir,
    ],
    ['branch -m of main', () => 'git branch -m main velha', () => refs.dir],
    ['branch -M onto main', () => 'git branch -M outra main', () => refs.dir],
    [
      'branch -m of the branch checked out, main',
      () => 'git branch -m nova',
      () => onMain.dir,
    ],
    ['branch -c of main', () => 'git branch -c main copia', () => refs.dir],
    ['branch -C onto main', () => 'git branch -C outra main', () => refs.dir],
    ['branch -d main', () => 'git branch -d main', () => refs.dir],
    ['branch -D main', () => 'git branch -D main', () => refs.dir],
    ['branch --delete main', () => 'git branch --delete main', () => refs.dir],
    [
      'symbolic-ref pointing HEAD of the checkout of main elsewhere',
      () => 'git symbolic-ref HEAD refs/heads/outra',
      () => onMain.dir,
    ],
    [
      'symbolic-ref --delete of HEAD in the checkout of main',
      () => 'git symbolic-ref --delete HEAD',
      () => onMain.dir,
    ],
    [
      'symbolic-ref that turns main into a symbolic ref',
      () => 'git symbolic-ref refs/heads/main refs/heads/outra',
      () => refs.dir,
    ],
    [
      'symbolic-ref that points another ref at main, for a later write',
      () =>
        `git symbolic-ref refs/heads/nova refs/heads/main && git update-ref refs/heads/nova ${featureSha}`,
      () => refs.dir,
    ],
    [
      'symbolic-ref that points another ref at a symbolic ref to main',
      () => 'git symbolic-ref refs/heads/nova refs/heads/atalho',
      () => refs.dir,
    ],
    [
      'symbolic-ref that points another ref at HEAD of the checkout of main',
      () => 'git symbolic-ref refs/heads/nova HEAD',
      () => onMain.dir,
    ],
    [
      'symbolic-ref that points another ref at HEAD, main in the checkout of main',
      () => 'git symbolic-ref refs/heads/nova HEAD',
      () => refs.dir,
    ],
    [
      'an update-ref --stdin batch that creates a symbolic ref to main',
      () =>
        `git update-ref --stdin <<'EOF'\nsymref-create refs/heads/nova refs/heads/main\nupdate refs/heads/nova ${featureSha}\nEOF`,
      () => refs.dir,
    ],
    [
      'fetch <src>:main',
      () => `git fetch origin ${FEATURE}:main`,
      () => refs.dir,
    ],
    [
      'fetch +<src>:main',
      () => `git fetch origin +${FEATURE}:main`,
      () => refs.dir,
    ],
    [
      'fetch into refs/heads/main from this repository',
      () => 'git fetch . HEAD:refs/heads/main',
      () => refs.dir,
    ],
    [
      'fetch of a pattern into refs/heads/*',
      () => "git fetch origin '+refs/heads/*:refs/heads/*'",
      () => refs.dir,
    ],
    [
      'fetch with a configured refspec into main',
      () =>
        "git -c 'remote.origin.fetch=+refs/heads/*:refs/heads/*' fetch origin",
      () => refs.dir,
    ],
    [
      'fetch whose --refmap stores into refs/heads/*',
      () => `git fetch origin ${FEATURE} --refmap='+refs/heads/*:refs/heads/*'`,
      () => refs.dir,
    ],
    [
      'fetch --stdin with a refspec into main',
      () =>
        `git fetch --stdin origin <<'EOF'\n+refs/heads/${FEATURE}:refs/heads/main\nEOF`,
      () => refs.dir,
    ],
    [
      'fetch into HEAD in the checkout of main',
      () => `git fetch origin ${FEATURE}:HEAD`,
      () => onMain.dir,
    ],
    [
      'pull <src>:main',
      () => `git pull origin ${FEATURE}:main`,
      () => refs.dir,
    ],
    [
      'replace of main’s commit',
      () => `git replace ${mainSha} ${featureSha}`,
      () => refs.dir,
    ],
    [
      'replace --graft of main’s commit',
      () => `git replace --graft main`,
      () => refs.dir,
    ],
    [
      'push to main of this repository',
      () => 'git push . HEAD:main',
      () => refs.dir,
    ],
    [
      'push to MAIN of this repository',
      () => `git push ${refs.dir} HEAD:MAIN`,
      () => refs.dir,
    ],
    [
      'push to MAIN of a remote it cannot read, which may be on disk',
      () => 'git push "$R" HEAD:MAIN',
      () => refs.dir,
    ],
    ['branch -f MAIN', () => 'git branch -f MAIN', () => refs.dir],
    ['checkout -B main', () => 'git checkout -B main', () => refs.dir],
    ['switch -C main', () => 'git switch -C main origin/main', () => refs.dir],
    [
      'worktree add -B main',
      () => 'git worktree add -B main ../outra-arvore',
      () => refs.dir,
    ],
    [
      'subtree split --branch main',
      () => 'git subtree split --prefix=src --branch main',
      () => refs.dir,
    ],
    [
      'reset of the checkout of main to a commit',
      () => `git reset --soft ${onMain.headSha}`,
      () => onMain.dir,
    ],
    ['rebase of main', () => `git rebase ${FEATURE} main`, () => refs.dir],
    [
      'filter-branch of every branch',
      () => 'git filter-branch -- --all',
      () => refs.dir,
    ],
    [
      'fast-import of a commit on main',
      () =>
        "git fast-import <<'EOF'\ncommit refs/heads/main\ncommitter A <a@b> 0 +0000\ndata 0\nEOF",
      () => refs.dir,
    ],
  ])('denies %s, in default and auto', (_, text, cwd) => {
    const decision = verdict(text(), cwd())
    expect(modes(decision)).toEqual(['deny', 'deny'])
    expect(decision.reason).toMatch(moves)
  })

  it.each<[string, () => string, () => string]>([
    [
      'update-ref of a ref it cannot read',
      () => `git update-ref "$REF" ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref --stdin fed by a pipe',
      () =>
        `printf 'update refs/heads/main ${featureSha}\\n' | git update-ref --stdin`,
      () => refs.dir,
    ],
    [
      'update-ref --stdin with an expansion in the batch',
      () => `git update-ref --stdin <<EOF\nupdate $REF ${featureSha}\nEOF`,
      () => refs.dir,
    ],
    [
      'update-ref --stdin with a line it cannot read',
      () =>
        `git update-ref --stdin <<'EOF'\nupdate "refs/heads/ma\\151n ${featureSha}\nEOF`,
      () => refs.dir,
    ],
    [
      'branch -f of a name it cannot read',
      () => 'git branch -f "$B"',
      () => refs.dir,
    ],
    [
      'branch -m of the branch checked out, after the line moved HEAD',
      () => 'git checkout -q main && git branch -m nova',
      () => refs.dir,
    ],
    [
      'symbolic-ref of HEAD in the checkout of main, to a target it cannot read',
      () => 'git symbolic-ref HEAD "$T"',
      () => onMain.dir,
    ],
    [
      'fetch into a destination it cannot read',
      () => 'git fetch origin "$SPEC"',
      () => refs.dir,
    ],
    [
      'replace of an object it cannot read',
      () => `git replace "$OBJ" ${featureSha}`,
      () => refs.dir,
    ],
    [
      'replace --convert-graft-file, whose grafts it does not read',
      () => 'git replace --convert-graft-file',
      () => refs.dir,
    ],
    [
      'an option it does not know, then update-ref of main',
      () => `git --opcao-nova HEAD update-ref refs/heads/main ${featureSha}`,
      () => refs.dir,
    ],
  ])('asks, critical, for %s: denied in auto', (_, text, cwd) => {
    const line = text()
    const decision = line.includes('checkout -q main')
      ? judge(line, cwd(), {
          seen: (repo) => ({ ...repo, branchKnown: false }),
        }).decision
      : verdict(line, cwd())
    expect(modes(decision)).toEqual(['ask', 'deny'])
    expect(decision.critical).toBe(true)
  })

  it.each<[string, () => string, () => string]>([
    [
      'update-ref of a branch of the issue',
      () => `git update-ref refs/heads/feature/9-outra ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref of origin’s copy of main',
      () => `git update-ref refs/remotes/origin/main ${mainSha}`,
      () => refs.dir,
    ],
    [
      'update-ref --no-deref of the symbolic ref itself',
      () => `git update-ref --no-deref refs/heads/atalho ${featureSha}`,
      () => refs.dir,
    ],
    [
      'an update-ref --stdin batch that writes the symbolic ref itself, after option no-deref',
      () =>
        `git update-ref --stdin <<'EOF'\noption no-deref\nupdate refs/heads/atalho ${featureSha}\nEOF`,
      () => refs.dir,
    ],
    [
      'update-ref of HEAD on a branch of the issue',
      () => `git update-ref HEAD ${featureSha}`,
      () => refs.dir,
    ],
    [
      'update-ref -d of a tag',
      () => 'git update-ref -d refs/tags/v1',
      () => refs.dir,
    ],
    [
      'an update-ref --stdin batch that only verifies main',
      () =>
        `git update-ref --stdin <<'EOF'\nupdate refs/heads/outra ${featureSha}\nverify refs/heads/main ${mainSha}\nEOF`,
      () => refs.dir,
    ],
    [
      'an update-ref -z --stdin batch of another ref',
      () => 'git update-ref -z --stdin < lote-outra.bin',
      () => refs.dir,
    ],
    [
      'an update-ref -z --stdin batch that writes the symbolic ref itself, after option no-deref',
      () => 'git update-ref -z --stdin < lote-sem-deref.bin',
      () => refs.dir,
    ],
    [
      'update-ref of main in another repository',
      () => `git update-ref refs/heads/main ${mainSha}`,
      () => elsewhere.dir,
    ],
    [
      'branch -f of a branch of the issue',
      () => `git branch -f feature/9-outra ${mainSha}`,
      () => refs.dir,
    ],
    [
      'branch -D of another branch',
      () => 'git branch -D feature/9-velha',
      () => refs.dir,
    ],
    [
      'branch -m between two branches',
      () => 'git branch -m feature/9-a feature/9-b',
      () => refs.dir,
    ],
    [
      'branch -m of the branch of the issue',
      () => 'git branch -m feature/5-novo',
      () => refs.dir,
    ],
    ['branch --list main', () => 'git branch --list main', () => refs.dir],
    ['branch -a', () => 'git branch -a', () => refs.dir],
    ['branch -vv', () => 'git branch -vv', () => refs.dir],
    [
      'branch --contains main',
      () => 'git branch --contains main',
      () => refs.dir,
    ],
    [
      'branch -dr of origin’s main',
      () => 'git branch -dr origin/main',
      () => refs.dir,
    ],
    [
      'branch --set-upstream-to',
      () => 'git branch --set-upstream-to origin/main',
      () => refs.dir,
    ],
    [
      'branch --unset-upstream',
      () => 'git branch --unset-upstream',
      () => refs.dir,
    ],
    [
      'symbolic-ref of HEAD on a branch of the issue',
      () => 'git symbolic-ref HEAD refs/heads/outra',
      () => refs.dir,
    ],
    ['symbolic-ref read', () => 'git symbolic-ref HEAD', () => onMain.dir],
    [
      'symbolic-ref of another ref to a branch of the issue',
      () => `git symbolic-ref refs/heads/nova refs/heads/${FEATURE}`,
      () => refs.dir,
    ],
    [
      'an update-ref --stdin batch that creates a symbolic ref to another branch',
      () =>
        `git update-ref --stdin <<'EOF'\nsymref-create refs/heads/nova refs/heads/${FEATURE}\nEOF`,
      () => refs.dir,
    ],
    [
      'symbolic-ref of HEAD in the checkout of main, to main',
      () => 'git symbolic-ref HEAD refs/heads/main',
      () => onMain.dir,
    ],
    ['fetch origin', () => 'git fetch -q origin --prune', () => refs.dir],
    [
      'fetch of main into origin/main',
      () => 'git fetch origin main',
      () => refs.dir,
    ],
    [
      'fetch into refs/remotes',
      () => `git fetch -q origin ${FEATURE}:refs/remotes/origin/${FEATURE}`,
      () => refs.dir,
    ],
    [
      'fetch of a pattern into refs/remotes',
      () => "git fetch origin '+refs/heads/*:refs/remotes/origin/*'",
      () => refs.dir,
    ],
    [
      'fetch --dry-run into main',
      () => `git fetch --dry-run origin ${FEATURE}:main`,
      () => refs.dir,
    ],
    [
      'fetch whose --refmap stores into refs/remotes',
      () =>
        `git fetch origin ${FEATURE} --refmap='+refs/heads/*:refs/remotes/origin/*'`,
      () => refs.dir,
    ],
    [
      'fetch --stdin with a refspec into refs/remotes',
      () =>
        `git fetch --stdin origin <<'EOF'\n+refs/heads/${FEATURE}:refs/remotes/origin/${FEATURE}\nEOF`,
      () => refs.dir,
    ],
    [
      'fetch into HEAD on a branch of the issue',
      () => `git fetch origin ${FEATURE}:HEAD`,
      () => refs.dir,
    ],
    [
      'subtree split --branch of a branch of the issue',
      () => 'git subtree split --prefix=src --branch feature/9-sub',
      () => refs.dir,
    ],
    [
      'an option it does not know, then a subcommand that writes no ref',
      () => 'git --opcao-nova HEAD status',
      () => refs.dir,
    ],
    [
      'replace of a commit only the branch has',
      () => `git replace ${featureSha} ${mainSha}`,
      () => refs.dir,
    ],
    ['replace -d', () => `git replace -d ${mainSha}`, () => refs.dir],
    ['replace -l', () => 'git replace -l', () => refs.dir],
    [
      'tag -f main (out of scope: it moves no branch)',
      () => 'git tag -f main',
      () => refs.dir,
    ],
    [
      'push to another branch of this repository',
      () => 'git push . HEAD:feature/9-copia',
      () => refs.dir,
    ],
    // GitHub tells MAIN from main: over the network, MAIN is another branch
    // (the case is folded only for a repository on disk).
    [
      'push to MAIN of origin',
      () => 'git push origin HEAD:MAIN',
      () => refs.dir,
    ],
    [
      'push to refs/heads/MAIN of origin',
      () => 'git push origin HEAD:refs/heads/MAIN',
      () => refs.dir,
    ],
    [
      'push --delete of MAIN of origin',
      () => 'git push origin --delete MAIN',
      () => refs.dir,
    ],
    [
      'checkout -B of a branch of the issue',
      () => 'git checkout -B feature/9-outra',
      () => refs.dir,
    ],
    [
      'switch -C of a branch of the issue, from origin/main',
      () => 'git switch -C feature/9-outra origin/main',
      () => refs.dir,
    ],
    [
      'reset --soft on a branch of the issue',
      () => 'git reset --soft HEAD',
      () => refs.dir,
    ],
  ])('passes %s, in default and auto', (_, text, cwd) => {
    expect(modes(verdict(text(), cwd()))).toEqual(['pass', 'pass'])
  })
})
