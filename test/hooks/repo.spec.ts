import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base } from 'vitest'
import {
  gateCacheFile,
  planPendingFile,
  planPendingPrefix,
} from '../../scripts/loop-sections.mjs'
import {
  type HookRepo,
  hookRepo,
  type HookRepoOptions,
  loadHookLib,
  PROJECT,
  type RepoLib,
  setupTimeout,
  processTimeout,
} from '../support/hooks'
import { exec } from '../support/temp-repo'

/**
 * Which repository a hook looks at (.claude/hooks/lib/repo.mjs). The rules
 * only apply to this project, so an identity read wrong either way is a
 * hole: another repository judged as this one blocks work there, and this
 * one judged as another lets every rule pass.
 */

let lib: RepoLib

beforeAll(async () => {
  lib = await loadHookLib<RepoLib>('repo')
}, setupTimeout)

/**
 * Each case builds its own repositories and temp dirs, removed when it
 * finishes, so the cases can run concurrently: every repository costs a few
 * git spawns, and on a machine where each spawn is scanned that is minutes
 * one by one (gate.spec.ts does the same).
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
    const dirs: string[] = []
    await use(() => {
      const dir = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'repo-lib-')),
      )
      dirs.push(dir)
      return dir
    })
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  },
})

vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })

const BRANCH = 'feature/42-a-thing'

describe('constants', () => {
  it('names the project and the trunk', () => {
    expect(lib.projectRepo).toBe(PROJECT)
    expect(lib.trunk).toBe('main')
  })
})

describe.concurrent('repoAt', () => {
  test('reads top, git dir, branch and project from the worktree top', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    expect(lib.repoAt(repo.dir, { env: repo.env() })).toEqual({
      top: repo.dir,
      gitDir: repo.gitDir,
      commonDir: repo.gitDir,
      branch: BRANCH,
      repo: PROJECT,
    })
  })

  test('reads main as the branch on main', async ({ expect, fresh }) => {
    const repo = await fresh()
    expect(lib.repoAt(repo.dir, { env: repo.env() })?.branch).toBe('main')
  })

  test('finds the same worktree from a subdirectory', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    repo.write({ 'src/app/x.ts': '' })
    expect(
      lib.repoAt(path.join(repo.dir, 'src', 'app'), { env: repo.env() })?.top,
    ).toBe(repo.dir)
  })

  test('reads a path that does not exist yet from its nearest existing directory', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const found = lib.repoAt(path.join(repo.dir, 'src', 'new', 'deep'), {
      env: repo.env(),
    })
    expect(found?.top).toBe(repo.dir)
    expect(found?.branch).toBe(BRANCH)
  })

  test('reads a file path as its directory', async ({ expect, fresh }) => {
    const repo = await fresh()
    expect(
      lib.repoAt(path.join(repo.dir, 'README.md'), { env: repo.env() })?.top,
    ).toBe(repo.dir)
  })

  test('gives a null branch on a detached HEAD', async ({ expect, fresh }) => {
    const repo = await fresh({ detached: true })
    const found = lib.repoAt(repo.dir, { env: repo.env() })
    expect(found?.branch).toBeNull()
    expect(found?.repo).toBe(PROJECT)
  })

  test('reads the branch main even when a tag is also named main', async ({
    expect,
    fresh,
  }) => {
    // git symbolic-ref --short prints heads/main when a tag main exists, and
    // no rule would read that as the trunk.
    const repo = await fresh({ branch: 'main' })
    await repo.git('tag', 'main')
    expect(lib.repoAt(repo.dir, { env: repo.env() })?.branch).toBe('main')
    await repo.git('switch', '-q', '-c', BRANCH)
    expect(lib.repoAt(repo.dir, { env: repo.env() })?.branch).toBe(BRANCH)
  })

  test('tells a linked worktree git dir from the common dir', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    const linked = await repo.addWorktree('linked', BRANCH)
    expect(lib.repoAt(linked.dir, { env: repo.env() })).toEqual({
      top: linked.dir,
      gitDir: linked.gitDir,
      commonDir: repo.gitDir,
      branch: BRANCH,
      repo: PROJECT,
    })
    expect(linked.gitDir).toBe(path.join(repo.gitDir, 'worktrees', 'linked'))
  })

  test('reads a directory inside the git dir as its worktree, not as no repository', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const found = lib.repoAt(path.join(repo.gitDir, 'hooks'), {
      env: repo.env(),
    })
    expect(found).toEqual({
      top: repo.dir,
      gitDir: repo.gitDir,
      commonDir: repo.gitDir,
      branch: BRANCH,
      repo: PROJECT,
    })
  })

  test('reads a linked worktree admin dir as that worktree', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    const linked = await repo.addWorktree('linked', BRANCH)
    const found = lib.repoAt(linked.gitDir, { env: repo.env() })
    expect(found?.top).toBe(linked.dir)
    expect(found?.branch).toBe(BRANCH)
    expect(found?.commonDir).toBe(repo.gitDir)
  })

  test('returns null outside any repository', ({ expect, scratch }) => {
    const dir = scratch()
    expect(lib.repoAt(dir)).toBeNull()
    expect(lib.repoAt(path.join(dir, 'missing', 'file.txt'))).toBeNull()
  })

  test('returns null for a bare repository, which has no worktree', async ({
    expect,
    scratch,
  }) => {
    const dir = scratch()
    const run = await exec('git', ['init', '-q', '--bare', 'bare.git'], {
      cwd: dir,
    })
    expect(run.status).toBe(0)
    expect(lib.repoAt(path.join(dir, 'bare.git'))).toBeNull()
  })

  test('ignores a GIT_DIR inherited from the environment', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const other = await fresh({ origin: 'https://github.com/someone/else.git' })
    const found = lib.repoAt(repo.dir, {
      env: { ...repo.env(), GIT_DIR: other.gitDir, GIT_WORK_TREE: other.dir },
    })
    expect(found?.top).toBe(repo.dir)
    expect(found?.repo).toBe(PROJECT)
  })

  test('throws when git cannot run, instead of reading it as no repository', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    expect(() =>
      lib.repoAt(repo.dir, { env: { ...repo.env(), PATH: '' } }),
    ).toThrow(/git não pôde rodar/)
  })

  test.for([
    ['HTTPS with .git', 'https://github.com/geazioliveira/marketo-sandbox.git'],
    ['HTTPS without .git', 'https://github.com/geazioliveira/marketo-sandbox'],
    [
      'HTTPS with a trailing slash',
      'https://github.com/geazioliveira/marketo-sandbox/',
    ],
    [
      'HTTPS with a user',
      'https://token@github.com/geazioliveira/marketo-sandbox.git',
    ],
    ['the scp form', 'git@github.com:geazioliveira/marketo-sandbox.git'],
    ['ssh://', 'ssh://git@github.com/geazioliveira/marketo-sandbox'],
    ['another case', 'https://github.com/GeazioLiveira/Marketo-Sandbox.git'],
  ])(
    'reads the project from origin in %s',
    async ([, origin], { expect, fresh }) => {
      const repo = await fresh({ origin })
      const found = lib.repoAt(repo.dir, { env: repo.env() })
      expect(found?.repo).toBe(PROJECT)
      expect(lib.isProject(found)).toBe(true)
    },
  )

  test.for<[string, string, string | null]>([
    [
      'another repository',
      'https://github.com/someone/marketo-sandbox.git',
      'someone/marketo-sandbox',
    ],
    [
      'a fork name',
      'git@github.com:geazioliveira/marketo-sandbox-fork.git',
      'geazioliveira/marketo-sandbox-fork',
    ],
    [
      'another host',
      'https://gitlab.com/geazioliveira/marketo-sandbox.git',
      null,
    ],
    ['a local path', '/srv/git/marketo-sandbox.git', null],
  ])(
    'reads %s as not the project',
    async ([, origin, name], { expect, fresh }) => {
      const repo = await fresh({ origin })
      const found = lib.repoAt(repo.dir, { env: repo.env() })
      expect(found?.repo).toBe(name)
      expect(lib.isProject(found)).toBe(false)
    },
  )

  test('gives a null repo without an origin', async ({ expect, fresh }) => {
    const repo = await fresh({ origin: null })
    const found = lib.repoAt(repo.dir, { env: repo.env() })
    expect(found?.repo).toBeNull()
    expect(found?.top).toBe(repo.dir)
    expect(lib.isProject(found)).toBe(false)
  })
})

describe('repository names', () => {
  it.each([
    ['geazioliveira/marketo-sandbox', true],
    ['GeazioLiveira/Marketo-Sandbox', true],
    ['github.com/geazioliveira/marketo-sandbox', true],
    ['https://github.com/geazioliveira/marketo-sandbox', true],
    ['git@github.com:geazioliveira/marketo-sandbox.git', true],
    ['someone/marketo-sandbox', false],
    ['geazioliveira/marketo', false],
    ['gitlab.com/geazioliveira/marketo-sandbox', false],
    ['marketo-sandbox', false],
    ['', false],
  ])('isProject(%j) is %s', (name, expected) => {
    expect(lib.isProject(name)).toBe(expected)
  })

  it('reads no repository from nothing', () => {
    expect(lib.isProject(null)).toBe(false)
    expect(lib.isProject(undefined)).toBe(false)
    expect(
      lib.isProject({
        top: '/x',
        gitDir: '/x/.git',
        commonDir: '/x/.git',
        branch: 'main',
        repo: null,
      }),
    ).toBe(false)
  })

  it('lowercases what it reads', () => {
    expect(lib.repoFromRemote('git@github.com:A/B.git')).toBe('a/b')
    expect(lib.repoFromArg('A/B')).toBe('a/b')
    expect(lib.repoFromRemote('A/B')).toBeNull()
  })
})

describe.concurrent('existingDirOf', () => {
  test('returns an existing directory itself, and a file its directory', ({
    expect,
    scratch,
  }) => {
    const dir = scratch()
    writeFileSync(path.join(dir, 'file.txt'), '')
    expect(lib.existingDirOf(dir)).toBe(dir)
    expect(lib.existingDirOf(path.join(dir, 'file.txt'))).toBe(dir)
  })

  test('climbs to the nearest existing directory of a missing path', ({
    expect,
    scratch,
  }) => {
    const dir = scratch()
    mkdirSync(path.join(dir, 'a'))
    expect(lib.existingDirOf(path.join(dir, 'a', 'b', 'c', 'd.ts'))).toBe(
      path.join(dir, 'a'),
    )
  })

  it('stops at the root', () => {
    expect(lib.existingDirOf('/')).toBe('/')
  })
})

describe.concurrent('real paths', () => {
  test('reads a target through a symlink as git reports it', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const repo = await fresh()
    const link = path.join(scratch(), 'link')
    symlinkSync(repo.dir, link)
    expect(lib.realPathOf(path.join(link, 'src', 'new.ts'))).toBe(
      path.join(repo.dir, 'src', 'new.ts'),
    )
    const found = lib.repoAt(link, { env: repo.env() })
    expect(found?.top).toBe(repo.dir)
    expect(lib.repoRelative(found!, path.join(link, 'src', 'new.ts'))).toBe(
      'src/new.ts',
    )
  })

  test('gives null outside the repository and an empty path at its top', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    const found = lib.repoAt(repo.dir, { env: repo.env() })!
    expect(lib.repoRelative(found, repo.dir)).toBe('')
    expect(lib.repoRelative(found, path.join(repo.root, 'elsewhere.txt'))).toBe(
      null,
    )
    expect(lib.repoRelative(found, path.join(repo.dir, '..repo-x'))).toBe(
      '..repo-x',
    )
  })
})

describe.concurrent('the gate cache', () => {
  test('reads the cache the gate wrote', async ({ expect, fresh }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    const cache = lib.readGateCache(repo.gitDir)
    expect(cache).toMatchObject({ branch: BRANCH, issue: 42, open: true })
  })

  test('is null when missing, unreadable or not an object', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const file = path.join(repo.gitDir, gateCacheFile)
    expect(lib.readGateCache(repo.gitDir)).toBeNull()
    writeFileSync(file, '{"open": true')
    expect(lib.readGateCache(repo.gitDir)).toBeNull()
    writeFileSync(file, '[{"open": true}]')
    expect(lib.readGateCache(repo.gitDir)).toBeNull()
    writeFileSync(file, 'null')
    expect(lib.readGateCache(repo.gitDir)).toBeNull()
  })

  test('reads each worktree its own cache', async ({ expect, fresh }) => {
    const repo = await fresh({ cache: true })
    const linked = await repo.addWorktree('linked', BRANCH)
    expect(lib.readGateCache(linked.gitDir)).toBeNull()
    expect(lib.readGateCache(repo.gitDir)).not.toBeNull()
  })

  test('clears the cache of every worktree from the common git dir (Copilot review of #26)', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ cache: true })
    expect(lib.worktreeGitDirs(repo.gitDir)).toEqual([repo.gitDir])
    const linked = await repo.addWorktree('linked', BRANCH)
    writeFileSync(path.join(linked.gitDir, gateCacheFile), '{}\n')
    expect(lib.worktreeGitDirs(repo.gitDir)).toEqual([
      repo.gitDir,
      realpathSync.native(linked.gitDir),
    ])
    lib.clearGateCaches(repo.gitDir)
    expect(existsSync(path.join(repo.gitDir, gateCacheFile))).toBe(false)
    expect(existsSync(path.join(linked.gitDir, gateCacheFile))).toBe(false)
    expect(() => lib.clearGateCaches(repo.gitDir)).not.toThrow()
  })

  test('throws when a cache cannot be removed', async ({ expect, fresh }) => {
    const repo = await fresh()
    const linked = await repo.addWorktree('linked', BRANCH)
    mkdirSync(path.join(linked.gitDir, gateCacheFile, 'dentro'), {
      recursive: true,
    })
    expect(() => lib.clearGateCaches(repo.gitDir)).toThrow()
  })
})

describe.concurrent('the pending-plan marker', () => {
  test('lives in the git dir under the contract name', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    expect(lib.pendingPlanPath(repo.gitDir, 'abc-123')).toBe(
      path.join(repo.gitDir, planPendingFile('abc-123')),
    )
  })

  test('is written, found and cleared', async ({ expect, fresh }) => {
    const repo = await fresh({ branch: BRANCH })
    const data = { schema: 1, sessionId: 's1', branch: BRANCH }
    expect(lib.pendingPlanExists(repo.gitDir, 's1')).toBe(false)
    const file = lib.writePendingPlan(repo.gitDir, 's1', data)
    expect(file).toBe(lib.pendingPlanPath(repo.gitDir, 's1'))
    expect(lib.pendingPlanExists(repo.gitDir, 's1')).toBe(true)
    expect(lib.pendingPlanExists(repo.gitDir, 's2')).toBe(false)
    expect(
      readdirSync(repo.gitDir).filter((name) => name.endsWith('.tmp')),
    ).toEqual([])
    lib.clearPendingPlan(repo.gitDir, 's1')
    expect(lib.pendingPlanExists(repo.gitDir, 's1')).toBe(false)
    expect(() => lib.clearPendingPlan(repo.gitDir, 's1')).not.toThrow()
  })

  test('counts a marker whatever it holds', async ({ expect, fresh }) => {
    const repo = await fresh()
    writeFileSync(lib.pendingPlanPath(repo.gitDir, 's1'), 'not json')
    expect(lib.pendingPlanExists(repo.gitDir, 's1')).toBe(true)
  })

  test('keeps a hostile session id inside the git dir', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    const file = lib.writePendingPlan(repo.gitDir, '../../escape', {})
    expect(path.dirname(file)).toBe(repo.gitDir)
    expect(path.basename(file).startsWith(planPendingPrefix)).toBe(true)
    expect(existsSync(path.join(repo.dir, 'escape'))).toBe(false)
  })

  test('keeps sessions whose ids differ only in the characters it escapes apart (Copilot review of #26, fifth round)', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    for (const id of ['a/b', 'a_b', 'a_2Fb'])
      lib.writePendingPlan(repo.gitDir, id, { sessionId: id })
    // One session's publication clears its own marker, and only it.
    lib.clearPendingPlan(repo.gitDir, 'a/b')
    expect(lib.pendingPlanExists(repo.gitDir, 'a/b')).toBe(false)
    expect(lib.pendingPlanExists(repo.gitDir, 'a_b')).toBe(true)
    expect(lib.pendingPlanExists(repo.gitDir, 'a_2Fb')).toBe(true)
  })

  test('leaves no scratch file behind when the marker cannot be written', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    // A directory where the marker goes: the rename onto it fails.
    mkdirSync(path.join(lib.pendingPlanPath(repo.gitDir, 's1'), 'x'), {
      recursive: true,
    })
    expect(() => lib.writePendingPlan(repo.gitDir, 's1', {})).toThrow()
    expect(
      readdirSync(repo.gitDir).filter((name) => name.endsWith('.tmp')),
    ).toEqual([])
  })
})

describe('harness paths', () => {
  it('holds exactly the spec list', () => {
    expect(lib.harnessPaths).toEqual([
      '.claude/',
      '.github/',
      'scripts/gate.mjs',
      'scripts/loop-sections.mjs',
      'scripts/loop-sections.d.mts',
      'scripts/audit-main.mjs',
      'scripts/refresh-issue-link.mjs',
      'scripts/check-context.mjs',
    ])
  })

  it.each([
    '.claude/settings.json',
    '.claude/hooks/guard-bash.mjs',
    '.claude',
    '.github/workflows/issue-link.yml',
    '.github',
    'scripts/gate.mjs',
    'scripts/loop-sections.mjs',
    'scripts/loop-sections.d.mts',
    'scripts/audit-main.mjs',
    'scripts/refresh-issue-link.mjs',
    'scripts/check-context.mjs',
    './.claude/settings.json',
    'src/../.github/CODEOWNERS',
    '.Claude/Settings.json',
    'SCRIPTS/Gate.mjs',
    '.claude\\settings.json',
  ])('%s is a harness path', (file) => {
    expect(lib.isHarnessPath(file)).toBe(true)
  })

  it.each([
    'src/main.ts',
    'context/intent/feature-x.md',
    'scripts/gate.mjs.bak',
    'scripts/generate-marketo-definitions.py',
    'test/scripts/gate.spec.ts',
    '.claudex/y',
    '.githubx',
    '../.claude/settings.json',
    '/abs/.claude/settings.json',
    '',
  ])('%s is not a harness path', (file) => {
    expect(lib.isHarnessPath(file)).toBe(false)
  })
})

describe.concurrent('the test support (hookRepo)', () => {
  test('builds main with one commit, the project origin and the branch', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    expect(repo.branch).toBe(BRANCH)
    expect(await repo.git('rev-list', '--count', 'main')).toBe('1')
    expect(await repo.git('remote', 'get-url', 'origin')).toBe(
      `https://github.com/${PROJECT}.git`,
    )
    expect(await repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH)
    expect(repo.gitDir).toBe(path.join(repo.dir, '.git'))
  })

  test('writes the gate cache for the branch, checked now, and the marker', async ({
    expect,
    fresh,
  }) => {
    const before = Date.now()
    const repo = await fresh({
      branch: BRANCH,
      cache: { open: false },
      marker: 'sessao-1',
    })
    const cache = lib.readGateCache(repo.gitDir)
    expect(cache).toMatchObject({
      branch: BRANCH,
      issue: 42,
      open: false,
      verified: true,
      headSha: repo.headSha,
    })
    const checked = Date.parse(String(cache?.checkedAt))
    expect(checked).toBeGreaterThanOrEqual(before - 1000)
    expect(checked).toBeLessThanOrEqual(Date.now())
    expect(lib.pendingPlanExists(repo.gitDir, 'sessao-1')).toBe(true)
    expect(repo.markerPath('sessao-1')).toBe(
      lib.pendingPlanPath(repo.gitDir, 'sessao-1'),
    )
  })

  test('puts the fake gh first on PATH, with its fixture and log', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const script = path.join(scratch(), 'fake.mjs')
    writeFileSync(
      script,
      `import { appendFileSync, readFileSync } from 'node:fs'
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\\n')
process.stdout.write(readFileSync(process.env.FAKE_GH_FIXTURE, 'utf8'))
`,
    )
    const repo = await fresh({ fakeGh: { script, fixture: { viewer: 'x' } } })
    const run = await exec('gh', ['api', 'user'], {
      cwd: repo.dir,
      env: repo.env(),
    })
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({ viewer: 'x' })
    expect(repo.calls()).toEqual([{ argv: ['api', 'user'] }])
    repo.setFixture({ viewer: 'y' })
    const again = await exec('gh', ['api', 'user'], {
      cwd: repo.dir,
      env: repo.env(),
    })
    expect(JSON.parse(again.stdout)).toEqual({ viewer: 'y' })
  })

  test('detaches HEAD and leaves origin out when asked', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ detached: true, origin: null, cache: true })
    expect(repo.branch).toBeNull()
    expect(lib.readGateCache(repo.gitDir)).toMatchObject({
      branch: null,
      issue: null,
    })
    await expect(repo.git('remote', 'get-url', 'origin')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Seventh round of Copilot's review of #26

describe('the git config a command gives git (Copilot review of #26, seventh round)', () => {
  const inherited = {
    HOME: '/casa',
    GIT_CONFIG_GLOBAL: '/casa/.gitconfig',
    GIT_CONFIG_NOSYSTEM: '1',
    PATH: '/usr/bin',
  }

  it('names the variables that move git’s config', () => {
    for (const name of [
      'GIT_CONFIG',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_12',
      'GIT_CONFIG_PARAMETERS',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_SYSTEM',
      'GIT_CONFIG_NOSYSTEM',
      'HOME',
      'XDG_CONFIG_HOME',
    ])
      expect(lib.gitConfigVariable.test(name)).toBe(true)
    for (const name of ['GIT_DIR', 'GH_REPO', 'GIT_CONFIG_KEY_', 'PATH'])
      expect(lib.gitConfigVariable.test(name)).toBe(false)
  })

  it('is not set when the command keeps the inherited config', () => {
    expect(lib.commandGitConfig({}, inherited, '/w')).toEqual({ set: false })
    expect(
      lib.commandGitConfig(
        { HOME: '/casa', GH_REPO: 'a/b', GIT_DIR: '/x', XDG_CONFIG_HOME: '' },
        inherited,
        '/w',
      ),
    ).toEqual({ set: false })
  })

  it('gives the inherited environment with the command’s values over it, paths made absolute from its directory', () => {
    const config = lib.commandGitConfig(
      {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'user.name',
        GIT_CONFIG_VALUE_0: 'Outro',
        GIT_CONFIG_GLOBAL: 'cfg/global',
        HOME: '/outra',
      },
      inherited,
      '/w',
    )
    expect(config).toEqual({
      set: true,
      known: true,
      env: {
        ...inherited,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'user.name',
        GIT_CONFIG_VALUE_0: 'Outro',
        GIT_CONFIG_GLOBAL: '/w/cfg/global',
        HOME: '/outra',
      },
      what: 'o comando dá ao git uma configuração própria (GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL, GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0, HOME)',
    })
  })

  it.each([
    [{ GIT_CONFIG_VALUE_0: '$URL' }, 'GIT_CONFIG_VALUE_0 traz uma expansão'],
    [{ HOME: '`pwd`' }, 'HOME traz uma expansão'],
    [{ HOME: '' }, 'não sei se HOME fica vazia ou deixa de existir'],
    [{ GIT_CONFIG_GLOBAL: '~/x' }, 'GIT_CONFIG_GLOBAL começa com ~'],
    [{ GIT_CONFIG: '/x/config' }, 'GIT_CONFIG leva o git config'],
  ])('is unknown for %j', (overrides, why) => {
    const config = lib.commandGitConfig(overrides, inherited, '/w')
    expect(config).toMatchObject({ set: true, known: false })
    expect(config.set && !config.known ? config.why : '').toContain(why)
  })

  it('is unknown for a relative path with no directory, and for GIT_CONFIG inherited', () => {
    expect(
      lib.commandGitConfig({ GIT_CONFIG_GLOBAL: 'x.cfg' }, inherited, null),
    ).toMatchObject({ set: true, known: false })
    expect(
      lib.commandGitConfig(
        { HOME: '/outra' },
        { ...inherited, GIT_CONFIG: '/x' },
        '/w',
      ),
    ).toMatchObject({ set: true, known: false })
  })
})

describe.concurrent(
  'configuredRemote (Copilot review of #26, seventh round)',
  () => {
    const project = 'https://github.com/geazioliveira/marketo-sandbox.git'
    const other = 'https://github.com/alguem/outro.git'
    const withVars = (repo: HookRepo, pairs: [string, string][]) => {
      const env: NodeJS.ProcessEnv = {
        ...repo.env(),
        GIT_CONFIG_COUNT: String(pairs.length),
      }
      for (const [index, [key, value]] of pairs.entries()) {
        env[`GIT_CONFIG_KEY_${index}`] = key
        env[`GIT_CONFIG_VALUE_${index}`] = value
      }
      return env
    }

    test('reads origin with the command’s config', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      const info = lib.repoAt(repo.dir, { env: repo.env() })
      expect(info).not.toBeNull()
      if (info === null) return
      expect(
        lib.configuredRemote(info, withVars(repo, [['user.name', 'Outro']])),
      ).toEqual({ known: true, repo: PROJECT })
      // The same URL twice is still one repository.
      expect(
        lib.configuredRemote(
          info,
          withVars(repo, [['remote.origin.url', project]]),
        ),
      ).toEqual({ known: true, repo: PROJECT })
      expect(
        lib.configuredRemote(
          info,
          withVars(repo, [['remote.origin.url', other]]),
        ),
      ).toEqual({
        known: false,
        why: 'o origin aponta para mais de um repositório',
      })
    })

    test.for<[string, [string, string][], string]>([
      [
        'a rewriting of URLs',
        [[`url.${project}.insteadOf`, other]],
        'ela reescreve URLs',
      ],
      [
        'a push rewriting',
        [[`url.${project}.pushInsteadOf`, other]],
        'ela reescreve URLs',
      ],
      [
        'an include',
        [['include.path', '/nao/existe.cfg']],
        'ela inclui outro arquivo',
      ],
      [
        'a conditional include',
        [['includeIf.gitdir:/x/.path', '/nao/existe.cfg']],
        'ela inclui outro arquivo',
      ],
      [
        'gh’s default repository',
        [['remote.origin.gh-resolved', 'base']],
        'ela dá ao gh um repositório padrão',
      ],
      [
        'another remote',
        [['remote.upstream.url', project]],
        'ela tem outro remote além do origin (upstream)',
      ],
      [
        'a push URL of origin',
        [['remote.origin.pushurl', project]],
        'o origin tem uma URL de push própria',
      ],
    ])('is unknown with %s', async ([, pairs, why], { expect, fresh }) => {
      const repo = await fresh({ origin: other })
      const info = lib.repoAt(repo.dir, { env: repo.env() })
      expect(info).not.toBeNull()
      if (info === null) return
      const found = lib.configuredRemote(info, withVars(repo, pairs))
      expect(found.known).toBe(false)
      expect(found.known ? '' : found.why).toContain(why)
    })

    test('is unknown when git refuses the config', async ({
      expect,
      fresh,
    }) => {
      const repo = await fresh()
      const info = lib.repoAt(repo.dir, { env: repo.env() })
      if (info === null) throw new Error('sem repositório')
      const env = { ...repo.env(), GIT_CONFIG_COUNT: '1' }
      const found = lib.configuredRemote(info, env)
      expect(found.known).toBe(false)
      expect(found.known ? '' : found.why).toContain(
        'o git recusou essa configuração',
      )
    })

    test('gives no repository without origin, and reads a linked worktree through its git dir', async ({
      expect,
      fresh,
    }) => {
      const bare = await fresh({ origin: null })
      const info = lib.repoAt(bare.dir, { env: bare.env() })
      if (info === null) throw new Error('sem repositório')
      expect(
        lib.configuredRemote(info, withVars(bare, [['user.name', 'Outro']])),
      ).toEqual({ known: true, repo: null })
      const repo = await fresh()
      const tree = await repo.addWorktree('arvore', 'feature/8-outra')
      const linked = lib.repoAt(tree.dir, { env: repo.env() })
      if (linked === null) throw new Error('sem worktree')
      expect(
        lib.configuredRemote(
          linked,
          withVars(repo, [[`url.${other}.insteadOf`, project]]),
        ),
      ).toMatchObject({ known: false })
      expect(
        lib.configuredRemote(linked, withVars(repo, [['user.name', 'Outro']])),
      ).toEqual({ known: true, repo: PROJECT })
    })
  },
)
