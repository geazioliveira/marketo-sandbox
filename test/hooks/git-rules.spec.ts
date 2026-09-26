import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
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
}

interface HeadChange {
  dir: string
  dirKnown: boolean
  head: { known: boolean; branch: string | null }
}

interface GitRulesLib {
  gitDecision(command: SimpleCommand, ctx: GitCtx): Decision
  headChangeOf(command: SimpleCommand, ctx: GitCtx): HeadChange | null
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
  ;[onMain, onFeature, elsewhere, aliased, fork] = await Promise.all([
    hookRepo(),
    hookRepo({ branch: FEATURE }),
    hookRepo({ origin: 'https://github.com/alguem/outro.git' }),
    hookRepo(),
    hookRepo({ branch: FEATURE, origin: 'https://github.com/alguem/fork.git' }),
  ])
  await Promise.all([
    aliased.git('config', 'alias.ci', 'commit'),
    aliased.git('config', 'alias.chain', 'ci -q'),
    aliased.git('config', 'alias.sh', '!git push origin HEAD:main'),
    aliased.git('config', 'alias.loop', 'loop'),
    fork.git('remote', 'add', 'upstream', PROJECT_URL),
  ])
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
}

/**
 * Every git command of the line through gitDecision, combined as guard-bash
 * does, with the directories repoAt was asked about. The environment is a
 * clean one: the machine's own git config must not decide a case.
 */
function judge(
  text: string,
  cwd: string,
  { seen, lineConfig, files, env = {} }: JudgeOptions = {},
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
    expect(verdict(text, onMain.dir)).toEqual({
      decision: 'deny',
      reason: onTrunk,
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
    ['a message it cannot read (a documented limit)', '-m "$MSG"'],
    ['a file that is not there', '-F /nao/existe.txt'],
    ['a reused message', '-C HEAD'],
  ])('passes %s', (_, args) => {
    expect(verdict(`git commit ${args}`, onFeature.dir).decision).toBe('pass')
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

  it('asks when a destination cannot be read', () => {
    expect(verdict('git push origin "$BRANCH"', onFeature.dir)).toMatchObject({
      decision: 'ask',
      critical: false,
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

  it('asks for a commit or a push in a directory it cannot read', () => {
    expect(verdict('git -C "$WT" commit -m x', onFeature.dir)).toMatchObject({
      decision: 'ask',
      critical: false,
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

  it('asks when the subcommand cannot be read', () => {
    expect(verdict('git "$SUB" -m x', onMain.dir)).toMatchObject({
      decision: 'ask',
      critical: false,
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
  ])('asks for %s', (_, text, reason) => {
    expect(verdict(text, aliased.dir)).toMatchObject({
      decision: 'ask',
      critical: false,
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

  it('asks when the config that decides the push cannot be read', () => {
    expect(
      verdict('git -c push.default="$M" push', onFeature.dir),
    ).toMatchObject({
      decision: 'ask',
      reason: /configuração que decide o destino do push/,
    })
    expect(
      verdict('git -c push.default=estranho push', onFeature.dir),
    ).toMatchObject({
      decision: 'ask',
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

  it('asks when the branch it moved to cannot be told', () => {
    const seen = moved(null, false)
    for (const text of [
      'git commit -m x',
      'git push',
      'git push origin HEAD',
      'git push origin @',
    ])
      expect(verdict(text, onFeature.dir, { seen })).toMatchObject({
        decision: 'ask',
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
