import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test as base } from 'vitest'
import {
  gateCacheFile,
  gateTtlHours,
  planPendingFile,
} from '../../scripts/loop-sections.mjs'
import {
  type HookRepo,
  hookRepo,
  type HookRepoOptions,
  hookPath,
  type HookRun,
  hooksDir,
  type IoLib,
  loadHookLib,
  PROJECT,
  type RepoLib,
  runHook,
  spawnWith,
  setupTimeout,
  processTimeout,
} from '../support/hooks'
import { ORIGIN, projectRoot } from '../support/temp-repo'

/**
 * The build guard (.claude/hooks/build-guard.mjs), run as Claude Code runs
 * it: a process with the PreToolUse input of an Edit, Write or NotebookEdit
 * on stdin, judged by what it prints. Every repository is a throwaway one
 * shaped like this project; the gate's cache and the pending-plan marker are
 * written into its git dir the way the gate and plan-to-issue write them.
 *
 * Each refusal has a passing control beside it: a guard that refused every
 * edit would pass every refusal case and stop all work.
 */

let io: IoLib
let repoLib: RepoLib

beforeAll(async () => {
  io = await loadHookLib<IoLib>('io')
  repoLib = await loadHookLib<RepoLib>('repo')
}, setupTimeout)

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
        mkdtempSync(path.join(tmpdir(), 'build-guard-')),
      )
      dirs.push(dir)
      return dir
    })
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  },
})

vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })

const BRANCH = 'feature/42-a-thing'
const SESSION = 'session-build-guard'

const MISSING = 'rode npm run gate na branch antes de editar'
const CLOSED =
  'o gate está fechado: rode npm run gate e resolva o que ele aponta'
const MAIN = 'em main, nada se edita: corte uma branch da issue'
const GIT_DIR = 'o diretório do git não se edita à mão'
const EMERGENCY = 'a saída de emergência é do dono'
const PENDING =
  'há um plano aceito nesta sessão e ainda não publicado numa issue: publique-o antes de construir'
const HARNESS = 'caminho do harness'

type Tool = 'Edit' | 'Write' | 'NotebookEdit'

/** The PreToolUse input of a file tool, as Claude Code sends it. */
function toolCall(
  filePath: string,
  {
    tool = 'Edit',
    mode = 'default',
    session = SESSION,
    cwd,
  }: { tool?: Tool; mode?: string; session?: string; cwd?: string } = {},
): Record<string, unknown> {
  const toolInput =
    tool === 'NotebookEdit'
      ? { notebook_path: filePath, new_source: 'x = 1' }
      : tool === 'Write'
        ? { file_path: filePath, content: 'x\n' }
        : { file_path: filePath, old_string: 'a', new_string: 'b' }
  return {
    session_id: session,
    transcript_path: '/dev/null',
    hook_event_name: 'PreToolUse',
    permission_mode: mode,
    tool_name: tool,
    tool_input: toolInput,
    ...(cwd === undefined ? {} : { cwd }),
  }
}

interface Verdict {
  status: number | null
  decision: string
  reason: string
}

/** What Claude Code reads from a run: pass is exit 0 with nothing printed. */
function verdict(run: HookRun): Verdict {
  const output = run.json?.hookSpecificOutput
  if (run.stdout.trim() === '')
    return { status: run.status, decision: 'pass', reason: '' }
  return {
    status: run.status,
    decision:
      output?.hookEventName === 'PreToolUse'
        ? String(output.permissionDecision)
        : `unreadable: ${run.stdout}`,
    reason: String(output?.permissionDecisionReason ?? ''),
  }
}

/**
 * Runs the guard on a path of the repository, given relative to its top and
 * joined as text, so `..` and case reach the hook as written.
 */
async function editIn(
  repo: HookRepo,
  file: string,
  options: Parameters<typeof toolCall>[1] = {},
): Promise<Verdict> {
  return verdict(
    await repo.run('build-guard', toolCall(`${repo.dir}/${file}`, options)),
  )
}

const hoursAgo = (hours: number): string =>
  new Date(Date.now() - hours * 3_600_000).toISOString()

/** An open gate's cache, as the gate writes it, for a worktree on BRANCH. */
function openCache(headSha: string): string {
  return `${JSON.stringify({
    schema: 1,
    repo: PROJECT,
    branch: BRANCH,
    issue: 42,
    headSha,
    open: true,
    verified: true,
    steps: [],
    checkedAt: new Date().toISOString(),
  })}\n`
}

/** The git the machine has, for a shim that wraps it. */
function realGit(): string {
  const found = spawnSync('sh', ['-c', 'command -v git'], {
    encoding: 'utf8',
  }).stdout.trim()
  if (!path.isAbsolute(found)) throw new Error('git não está no PATH')
  return found
}

/**
 * A directory holding a `git` that runs `before` in sh and then the real git
 * with the same arguments, to put first on the hook's PATH.
 */
function gitShim(dir: string, before: string): string {
  const bin = path.join(dir, 'shim-bin')
  mkdirSync(bin, { recursive: true })
  const git = `'${realGit().replaceAll("'", `'\\''`)}'`
  writeFileSync(
    path.join(bin, 'git'),
    `#!/bin/sh\n${before}\nexec ${git} "$@"\n`,
  )
  chmodSync(path.join(bin, 'git'), 0o755)
  return bin
}

/** The repository's environment with a shim directory first on PATH. */
function withShim(
  repo: HookRepo,
  bin: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return repo.env({
    PATH: [bin, repo.bin, process.env.PATH ?? ''].join(path.delimiter),
    ...extra,
  })
}

describe.concurrent('the input', () => {
  test('denies input that is not a JSON object', async ({ expect }) => {
    for (const text of ['não é json', '[1, 2]', 'null', '']) {
      const run = verdict(await runHook('build-guard', text))
      expect(run.status).toBe(0)
      expect(run.decision).toBe('deny')
      expect(run.reason).toBe(
        `${io.hookTag} a entrada do hook não pôde ser lida`,
      )
    }
  })

  test('denies a call that names no file', async ({ expect, fresh }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    for (const toolInput of [{}, { file_path: '' }, { file_path: 3 }, null]) {
      const run = verdict(
        await repo.run('build-guard', {
          ...toolCall('x'),
          tool_input: toolInput,
        }),
      )
      expect(run.decision).toBe('deny')
      expect(run.reason).toContain('não traz o caminho do arquivo')
    }
  })

  test('denies a relative path when the input has no cwd to resolve it', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    for (const cwd of [null, 'repo']) {
      const run = verdict(
        await repo.run('build-guard', { ...toolCall('src/a.ts'), cwd }),
      )
      expect(run.decision).toBe('deny')
      expect(run.reason).toContain('o caminho do arquivo é relativo')
    }
  })

  test('denies, not passes, when git cannot run', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    const run = verdict(
      await repo.run('build-guard', toolCall(path.join(repo.dir, 'src/a.ts')), {
        env: repo.env({ PATH: scratch() }),
      }),
    )
    expect(run.status).toBe(0)
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain('o hook falhou: git não pôde rodar')
  })
  test('does not fail open when its libraries cannot load', async ({
    expect,
    scratch,
  }) => {
    // A copy of the hook with no lib/ beside it: there is no io.mjs to print
    // a decision with, so it exits 2, which blocks the tool call.
    const bare = path.join(scratch(), '.claude', 'hooks')
    mkdirSync(bare, { recursive: true })
    copyFileSync(hookPath('build-guard'), path.join(bare, 'build-guard.mjs'))
    const input = JSON.stringify(toolCall('/tmp/x'))
    const noLib = await spawnWith(
      process.execPath,
      [path.join(bare, 'build-guard.mjs')],
      { input },
    )
    expect(noLib.status).toBe(2)
    expect(noLib.stdout).toBe('')
    expect(noLib.stderr).toContain('o hook falhou')

    // With io.mjs and without repo.mjs, it prints a deny.
    mkdirSync(path.join(bare, 'lib'))
    copyFileSync(
      path.join(hooksDir, 'lib', 'io.mjs'),
      path.join(bare, 'lib', 'io.mjs'),
    )
    const noRepo = await spawnWith(
      process.execPath,
      [path.join(bare, 'build-guard.mjs')],
      { input },
    )
    expect(noRepo.status).toBe(0)
    const output = JSON.parse(noRepo.stdout) as {
      hookSpecificOutput: {
        permissionDecision: string
        permissionDecisionReason: string
      }
    }
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
      'o hook falhou',
    )
  })

  test('denies when git is too slow for the budget of the run', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    await repo.commit({ '.gitignore': 'dist/\n' }, 'Ignore')
    const bin = gitShim(scratch(), 'sleep 0.3')
    const call = toolCall(`${repo.dir}/dist/a.js`)
    const late = verdict(
      await repo.run('build-guard', call, {
        env: withShim(repo, bin, { LOOP_HOOKS_BUILD_GUARD_BUDGET_MS: '100' }),
      }),
    )
    expect(late.decision).toBe('deny')
    expect(late.reason).toContain('o prazo de 0.1 s acabou')
    // The same slow git within the budget: the ignored file passes.
    const inTime = verdict(
      await repo.run('build-guard', call, { env: withShim(repo, bin) }),
    )
    expect(inTime.decision).toBe('pass')
  })

  test('denies a gate state the guard does not know', async ({
    expect,
    fresh,
    scratch,
  }) => {
    // A copy of the hook whose contract module reports a state added after
    // it: the real contract, with gateStatus replaced.
    const root = scratch()
    const hooks = path.join(root, '.claude', 'hooks')
    mkdirSync(path.join(hooks, 'lib'), { recursive: true })
    copyFileSync(hookPath('build-guard'), path.join(hooks, 'build-guard.mjs'))
    for (const lib of ['io.mjs', 'repo.mjs'])
      copyFileSync(
        path.join(hooksDir, 'lib', lib),
        path.join(hooks, 'lib', lib),
      )
    mkdirSync(path.join(root, 'scripts'))
    const contract = pathToFileURL(
      path.join(projectRoot, 'scripts', 'loop-sections.mjs'),
    ).href
    writeFileSync(
      path.join(root, 'scripts', 'loop-sections.mjs'),
      `export * from ${JSON.stringify(contract)}\nexport function gateStatus() {\n  return { state: 'recém-chegado' }\n}\n`,
    )
    const repo = await fresh({ branch: BRANCH, cache: true })
    const run = await spawnWith(
      process.execPath,
      [path.join(hooks, 'build-guard.mjs')],
      {
        input: JSON.stringify({
          ...toolCall(`${repo.dir}/src/a.ts`),
          cwd: repo.dir,
        }),
        env: repo.env(),
        cwd: repo.dir,
      },
    )
    const decided = verdict({
      ...run,
      json: run.stdout.trim() === '' ? null : JSON.parse(run.stdout),
    })
    expect(decided.status).toBe(0)
    expect(decided.decision).toBe('deny')
    expect(decided.reason).toContain(
      'estado do gate desconhecido (recém-chegado)',
    )
  })
})

describe.concurrent('which repository', () => {
  test('passes in another repository, on main and with no gate', async ({
    expect,
    fresh,
  }) => {
    const other = await fresh({ origin: 'https://github.com/someone/else.git' })
    expect((await editIn(other, 'src/a.ts')).decision).toBe('pass')
    const noOrigin = await fresh({ origin: null })
    expect((await editIn(noOrigin, 'src/a.ts')).decision).toBe('pass')
    const control = await fresh()
    expect((await editIn(control, 'src/a.ts')).decision).toBe('deny')
  })

  test('passes outside any repository', async ({ expect, scratch }) => {
    const dir = scratch()
    for (const file of [
      '/tmp/x',
      path.join(dir, 'x.txt'),
      path.join(dir, 'new', 'deep', 'x.txt'),
    ]) {
      const run = verdict(
        await runHook('build-guard', toolCall(file, { cwd: dir })),
      )
      expect(run).toEqual({ status: 0, decision: 'pass', reason: '' })
    }
  })

  test('resolves a relative file_path against the input cwd, not the process cwd', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const repo = await fresh()
    // repo.root holds the repository in repo/, and is no repository itself.
    const inside = verdict(
      await repo.run(
        'build-guard',
        toolCall('repo/src/a.ts', { cwd: repo.root }),
        {
          cwd: scratch(),
        },
      ),
    )
    expect(inside.decision).toBe('deny')
    expect(inside.reason).toContain(MAIN)
    const elsewhere = verdict(
      await repo.run(
        'build-guard',
        toolCall('repo/src/a.ts', { cwd: scratch() }),
        {
          cwd: repo.dir,
        },
      ),
    )
    expect(elsewhere.decision).toBe('pass')
  })

  test('judges a new file in a directory that does not exist yet', async ({
    expect,
    fresh,
  }) => {
    const deep = 'src/brand/new/deep/file.ts'
    const open = await fresh({ branch: BRANCH, cache: true })
    expect((await editIn(open, deep, { tool: 'Write' })).decision).toBe('pass')
    const noGate = await fresh({ branch: BRANCH })
    const refused = await editIn(noGate, deep, { tool: 'Write' })
    expect(refused.decision).toBe('deny')
    expect(refused.reason).toContain(MISSING)
    const onMain = await fresh()
    expect((await editIn(onMain, deep, { tool: 'Write' })).reason).toContain(
      MAIN,
    )
  })

  test('reads the notebook_path of a NotebookEdit', async ({
    expect,
    fresh,
  }) => {
    const onMain = await fresh()
    const refused = await editIn(onMain, 'notebooks/a.ipynb', {
      tool: 'NotebookEdit',
    })
    expect(refused.decision).toBe('deny')
    expect(refused.reason).toContain(MAIN)
    const open = await fresh({ branch: BRANCH, cache: true })
    expect(
      (await editIn(open, 'notebooks/a.ipynb', { tool: 'NotebookEdit' }))
        .decision,
    ).toBe('pass')
  })

  test('judges each linked worktree by its own branch and its own cache', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    const linked = await repo.addWorktree('linked', BRANCH)
    writeFileSync(
      path.join(linked.gitDir, gateCacheFile),
      openCache(repo.headSha),
    )
    // The session sits in the main checkout, on main; the file is in the
    // linked worktree, whose gate is open.
    const inLinked = verdict(
      await repo.run(
        'build-guard',
        toolCall(path.join(linked.dir, 'src/a.ts'), { cwd: repo.dir }),
      ),
    )
    expect(inLinked.decision).toBe('pass')
    const inMain = verdict(
      await repo.run(
        'build-guard',
        toolCall(path.join(repo.dir, 'src/a.ts'), { cwd: linked.dir }),
      ),
    )
    expect(inMain.reason).toContain(MAIN)
  })

  test('judges a symlink by where it writes as well as by its own entry', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const onMain = await fresh()
    const outside = scratch()
    const link = path.join(outside, 'link.ts')
    symlinkSync(path.join(onMain.dir, 'README.md'), link)
    const through = verdict(
      await runHook('build-guard', toolCall(link, { cwd: outside }), {
        env: onMain.env(),
      }),
    )
    expect(through.decision).toBe('deny')
    expect(through.reason).toContain(MAIN)

    const open = await fresh({ branch: BRANCH, cache: true })
    const target = path.join(scratch(), 'settings.json')
    writeFileSync(target, '{}\n')
    mkdirSync(path.join(open.dir, '.claude'), { recursive: true })
    symlinkSync(target, path.join(open.dir, '.claude', 'settings.local.json'))
    const emergency = await editIn(open, '.claude/settings.local.json')
    expect(emergency.decision).toBe('deny')
    expect(emergency.reason).toContain(EMERGENCY)
  })

  test('judges both paths of a call that carries file_path and notebook_path', async ({
    expect,
    fresh,
  }) => {
    const open = await fresh({ branch: BRANCH, cache: true })
    const onMain = await fresh()
    const good = path.join(open.dir, 'src/a.ts')
    const bad = path.join(onMain.dir, 'src/a.ts')
    for (const [first, second] of [
      [good, bad],
      [bad, good],
    ]) {
      const run = verdict(
        await open.run('build-guard', {
          ...toolCall(first),
          tool_input: { file_path: first, notebook_path: second },
        }),
      )
      expect(run.decision, second).toBe('deny')
      expect(run.reason, second).toContain(MAIN)
    }
    const control = verdict(
      await open.run('build-guard', {
        ...toolCall(good),
        tool_input: { file_path: good, notebook_path: good },
      }),
    )
    expect(control.decision).toBe('pass')
  })

  test('also judges a ~ path in the home directory', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const repo = await fresh()
    const run = verdict(
      await repo.run(
        'build-guard',
        toolCall('~/repo/src/a.ts', { cwd: scratch() }),
        { env: repo.env({ HOME: repo.root }) },
      ),
    )
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain(MAIN)
  })
})

describe.concurrent('where the write lands', () => {
  // Opening a dangling link to write creates its target, as Node's
  // writeFileSync does: the guard judges the target, not the link's place.
  test('judges a dangling link outside the repository by its target', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const open = await fresh({ branch: BRANCH, cache: true })
    const outside = scratch()
    const writeThrough = async (link: string): Promise<Verdict> =>
      verdict(
        await runHook('build-guard', toolCall(link, { cwd: outside }), {
          env: open.env(),
        }),
      )

    const direct = path.join(outside, 'direct.json')
    symlinkSync(path.join(open.dir, '.claude/settings.local.json'), direct)
    const chained = path.join(outside, 'chained.json')
    symlinkSync(direct, chained)
    const dir = path.join(outside, 'dir')
    symlinkSync(path.join(open.dir, '.claude'), dir)
    for (const link of [
      direct,
      chained,
      path.join(dir, 'settings.local.json'),
    ]) {
      const run = await writeThrough(link)
      expect(run.decision, link).toBe('deny')
      expect(run.reason, link).toContain(EMERGENCY)
    }

    const plain = path.join(outside, 'plain.ts')
    symlinkSync(path.join(open.dir, 'src/new.ts'), plain)
    expect(await writeThrough(plain)).toEqual({
      status: 0,
      decision: 'pass',
      reason: '',
    })
  })

  test('judges a dangling link inside the repository by its target', async ({
    expect,
    fresh,
  }) => {
    const open = await fresh({ branch: BRANCH, cache: true })
    mkdirSync(path.join(open.dir, 'src'))
    symlinkSync('../.git/hooks/post-checkout', path.join(open.dir, 'src/hook'))
    symlinkSync(
      '../.github/workflows/evil.yml',
      path.join(open.dir, 'src/workflow'),
    )
    const hook = await editIn(open, 'src/hook', { tool: 'Write' })
    expect(hook.decision).toBe('deny')
    expect(hook.reason).toContain(GIT_DIR)
    const workflow = await editIn(open, 'src/workflow', { tool: 'Write' })
    expect(workflow.decision).toBe('ask')
    expect(workflow.reason).toContain(HARNESS)

    const closed = await fresh({ branch: BRANCH, cache: { open: false } })
    mkdirSync(path.join(closed.dir, 'context/intent'), { recursive: true })
    symlinkSync(
      '../../src/new.ts',
      path.join(closed.dir, 'context/intent/feature-link.md'),
    )
    const intent = await editIn(closed, 'context/intent/feature-link.md', {
      tool: 'Write',
    })
    expect(intent.decision).toBe('deny')
    expect(intent.reason).toContain(CLOSED)
    expect(
      (
        await editIn(closed, 'context/intent/feature-real.md', {
          tool: 'Write',
        })
      ).decision,
    ).toBe('pass')
  })

  test('denies a path whose links it cannot follow', async ({
    expect,
    scratch,
  }) => {
    const dir = scratch()
    symlinkSync(path.join(dir, 'b'), path.join(dir, 'a'))
    symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'))
    const run = verdict(
      await runHook('build-guard', toolCall(path.join(dir, 'a'), { cwd: dir })),
    )
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain('link simbólico que não consegui seguir')
  })

  test('takes `..` after a link from where the link points', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const onMain = await fresh()
    mkdirSync(path.join(onMain.dir, 'src/deep'), { recursive: true })
    const outside = scratch()
    symlinkSync(path.join(onMain.dir, 'src/deep'), path.join(outside, 'link'))
    mkdirSync(path.join(outside, 'plain'))
    const run = async (file: string): Promise<Verdict> =>
      verdict(
        await runHook('build-guard', toolCall(file, { cwd: outside }), {
          env: onMain.env(),
        }),
      )
    for (const file of [`${outside}/link/../x.ts`, 'link/../x.ts']) {
      const through = await run(file)
      expect(through.decision, file).toBe('deny')
      expect(through.reason, file).toContain(MAIN)
    }
    expect((await run(`${outside}/plain/../x.ts`)).decision).toBe('pass')
  })

  test('folds names as macOS compares them: ſ is s', async ({
    expect,
    fresh,
  }) => {
    const open = await fresh({ branch: BRANCH, cache: true })
    for (const file of [
      '.claude/ſettings.local.json',
      'sub/.claude/ſettings.local.json',
    ]) {
      const run = await editIn(open, file, { tool: 'Write' })
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toContain(EMERGENCY)
    }
    // The Kelvin sign is a K to the file system: scripts/check-context.mjs.
    for (const file of [
      'ſcripts/gate.mjs',
      `scripts/chec${String.fromCodePoint(0x212a)}-context.mjs`,
    ]) {
      const harness = await editIn(open, file)
      expect(harness.decision, file).toBe('ask')
      expect(harness.reason, file).toContain(HARNESS)
    }
  })
})

describe.concurrent('refused whatever the gate says', () => {
  test('denies everything on main, the intent included', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ cache: true })
    await repo.commit({ '.gitignore': 'dist/\n' }, 'Ignore')
    for (const file of [
      'src/a.ts',
      'README.md',
      'context/intent/feature-x.md',
      'dist/app.js',
    ]) {
      const run = await editIn(repo, file, { tool: 'Write' })
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toBe(`${io.hookTag} ${MAIN}`)
    }
  })

  test('denies on a detached HEAD, the intent included', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ detached: true, cache: true })
    for (const file of ['src/a.ts', 'context/intent/feature-x.md']) {
      const run = await editIn(repo, file)
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toContain('HEAD destacado')
    }
  })

  test('denies a file in the git dir', async ({ expect, fresh }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    for (const file of [
      path.join(repo.gitDir, 'config'),
      path.join(repo.gitDir, 'hooks', 'pre-commit'),
      path.join(repo.gitDir, gateCacheFile),
      repo.markerPath(SESSION),
      path.join(repo.gitDir, 'new', 'dir', 'file'),
    ]) {
      const run = verdict(await repo.run('build-guard', toolCall(file)))
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toContain(GIT_DIR)
    }
  })

  test("denies a linked worktree's git dir, the common dir and its .git file", async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh()
    const linked = await repo.addWorktree('linked', BRANCH)
    for (const file of [
      path.join(linked.gitDir, 'HEAD'),
      path.join(linked.gitDir, gateCacheFile),
      path.join(repo.gitDir, 'config'),
      path.join(linked.dir, '.git'),
    ]) {
      const run = verdict(
        await repo.run('build-guard', toolCall(file, { cwd: linked.dir })),
      )
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toContain(GIT_DIR)
    }
  })

  test('denies .claude/settings.local.json, open gate or not, ignored or not', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    await repo.commit(
      { '.gitignore': '.claude/settings.local.json\n' },
      'Ignore',
    )
    for (const file of [
      '.claude/settings.local.json',
      '.Claude/Settings.Local.JSON',
      'sub/.claude/settings.local.json',
    ]) {
      const run = await editIn(repo, file, { tool: 'Write' })
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toContain(EMERGENCY)
    }
    const onMain = await fresh()
    expect(
      (await editIn(onMain, '.claude/settings.local.json')).reason,
    ).toContain(EMERGENCY)
    const other = await fresh({
      branch: BRANCH,
      origin: 'git@github.com:someone/else.git',
    })
    expect((await editIn(other, '.claude/settings.local.json')).decision).toBe(
      'pass',
    )
  })
})

describe.concurrent('passed before the gate', () => {
  test('passes context/intent on a feature branch, with no gate, a closed one or a pending plan', async ({
    expect,
    fresh,
  }) => {
    const noGate = await fresh({ branch: BRANCH })
    const closed = await fresh({ branch: BRANCH, cache: { open: false } })
    const pending = await fresh({ branch: BRANCH, marker: SESSION })
    for (const repo of [noGate, closed, pending]) {
      const run = await editIn(repo, 'context/intent/feature-a-thing.md', {
        tool: 'Write',
      })
      expect(run).toEqual({ status: 0, decision: 'pass', reason: '' })
    }
  })

  test('does not pass the neighbours of context/intent', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    for (const file of [
      'context/intents/feature-a.md',
      'context/intent.md',
      'context/decisions/0009-x.md',
      'context/intent/../../src/a.ts',
      'src/context/intent/a.md',
    ]) {
      const run = await editIn(repo, file)
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toContain(MISSING)
    }
  })

  test('passes a gitignored file with no gate, but not under .claude/', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    await repo.commit(
      { '.gitignore': 'dist/\n*.log\n.claude/local/\n' },
      'Ignore',
    )
    for (const file of ['dist/app.js', 'dist/new/deep.js', 'debug.log']) {
      const run = await editIn(repo, file, { tool: 'Write' })
      expect(run.decision, file).toBe('pass')
    }
    const underClaude = await editIn(repo, '.claude/local/x.json')
    expect(underClaude.decision).toBe('deny')
    expect(underClaude.reason).toContain(MISSING)

    const open = await fresh({ branch: BRANCH, cache: true })
    await open.commit({ '.gitignore': '.claude/local/\n' }, 'Ignore')
    const harness = await editIn(open, '.claude/local/x.json')
    expect(harness.decision).toBe('ask')
    expect(harness.reason).toContain(HARNESS)
  })

  test('does not pass an ignored harness path outside .claude/ either', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    await repo.commit(
      { '.gitignore': '.github/local/\nscripts/gate.mjs\ndist/\n' },
      'Ignore',
    )
    for (const file of ['.github/local/x.yml', 'scripts/gate.mjs']) {
      const run = await editIn(repo, file, { tool: 'Write' })
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toContain(MISSING)
    }
    expect((await editIn(repo, 'dist/x.js')).decision).toBe('pass')
  })

  test("counts only the repository's own .gitignore files, and no negation", async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    await repo.commit(
      {
        '.gitignore': '*.log\n!keep.log\n',
        'sub/.gitignore': 'out/\n',
      },
      'Ignore',
    )
    // Sources the agent can write without an edit the gate judges: the
    // global excludes file (outside any repository) and info/exclude.
    const env = repo.env()
    const xdg = path.join(env.XDG_CONFIG_HOME ?? '', 'git')
    mkdirSync(xdg, { recursive: true })
    writeFileSync(path.join(xdg, 'ignore'), 'src/global/\n')
    mkdirSync(path.join(repo.gitDir, 'info'), { recursive: true })
    writeFileSync(path.join(repo.gitDir, 'info', 'exclude'), 'src/local/\n')
    const refused = async (file: string): Promise<void> => {
      const run = await editIn(repo, file, { tool: 'Write' })
      expect(run.decision, file).toBe('deny')
      expect(run.reason, file).toContain(MISSING)
    }
    for (const file of ['src/global/a.ts', 'src/local/a.ts', 'keep.log'])
      await refused(file)
    for (const file of ['debug.log', 'sub/out/a.js'])
      expect((await editIn(repo, file)).decision, file).toBe('pass')

    // A core.excludesFile named like a .gitignore, which replaces the
    // global one: git reports it as a relative .gitignore.
    repo.write({ 'extra/.gitignore': 'src/extra/\n' })
    await repo.git('config', 'core.excludesFile', 'extra/.gitignore')
    await refused('src/extra/a.ts')
  })

  test('reads a failed check-ignore as not ignored', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    await repo.commit({ '.gitignore': 'dist/\n' }, 'Ignore')
    const bin = gitShim(
      scratch(),
      'for arg in "$@"; do [ "$arg" = check-ignore ] && exit 128; done',
    )
    const run = verdict(
      await repo.run('build-guard', toolCall(`${repo.dir}/dist/a.js`), {
        env: withShim(repo, bin),
      }),
    )
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain(MISSING)
    expect((await editIn(repo, 'dist/a.js')).decision).toBe('pass')
  })

  test('reads the ignore rules of the repository around the file, whatever GIT_* says', async ({
    expect,
    fresh,
    scratch,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    await repo.commit({ '.gitignore': 'dist/\n' }, 'Ignore')
    repo.write({ 'dist/kept.js': 'x\n' })
    await repo.git('add', '-f', 'dist/kept.js')
    await repo.git('commit', '-q', '-m', 'Kept')
    // An empty index would make the tracked file look untracked, so ignored.
    const env = repo.env({
      GIT_INDEX_FILE: path.join(scratch(), 'empty-index'),
    })
    const run = verdict(
      await repo.run('build-guard', toolCall(`${repo.dir}/dist/kept.js`), {
        env,
      }),
    )
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain(MISSING)
  })

  test('does not pass a tracked file that an ignore pattern matches', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    await repo.commit({ '.gitignore': 'dist/\n' }, 'Ignore')
    repo.write({ 'dist/kept.js': 'x\n' })
    await repo.git('add', '-f', 'dist/kept.js')
    await repo.git('commit', '-q', '-m', 'Kept')
    const run = await editIn(repo, 'dist/kept.js')
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain(MISSING)
  })
})

describe.concurrent('the gate state', () => {
  test('open: passes an ordinary file', async ({ expect, fresh }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    for (const tool of ['Edit', 'Write'] as const)
      expect(await editIn(repo, 'src/app.module.ts', { tool })).toEqual({
        status: 0,
        decision: 'pass',
        reason: '',
      })
  })

  test('missing: denies', async ({ expect, fresh }) => {
    const repo = await fresh({ branch: BRANCH })
    const run = await editIn(repo, 'src/a.ts')
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain(MISSING)
  })

  test('stale: denies a cache past its hours, or dated in the future', async ({
    expect,
    fresh,
  }) => {
    for (const checkedAt of [
      hoursAgo(gateTtlHours + 1),
      hoursAgo(-1),
      'not a date',
    ]) {
      const repo = await fresh({ branch: BRANCH, cache: { checkedAt } })
      const run = await editIn(repo, 'src/a.ts')
      expect(run.decision, checkedAt).toBe('deny')
      expect(run.reason, checkedAt).toContain(MISSING)
    }
    const fresher = await fresh({
      branch: BRANCH,
      cache: { checkedAt: hoursAgo(gateTtlHours - 1) },
    })
    expect((await editIn(fresher, 'src/a.ts')).decision).toBe('pass')
  })

  test('mismatch: denies a cache of another branch, issue or schema', async ({
    expect,
    fresh,
  }) => {
    for (const cache of [
      { branch: 'feature/7-other' },
      { issue: 7 },
      { schema: 99 },
    ]) {
      const repo = await fresh({ branch: BRANCH, cache })
      const run = await editIn(repo, 'src/a.ts')
      expect(run.decision, JSON.stringify(cache)).toBe('deny')
      expect(run.reason, JSON.stringify(cache)).toContain(MISSING)
    }
  })

  test('closed: denies', async ({ expect, fresh }) => {
    const repo = await fresh({ branch: BRANCH, cache: { open: false } })
    const run = await editIn(repo, 'src/a.ts')
    expect(run.decision).toBe('deny')
    expect(run.reason).toBe(`${io.hookTag} ${CLOSED}`)
  })

  test('unverified: asks, critical, when the gate opened without reading the issue', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: { verified: false } })
    const run = await editIn(repo, 'src/a.ts')
    expect(run.decision).toBe('ask')
    expect(run.reason).toContain('não verificado')
    for (const mode of io.autonomousModes) {
      const auto = await editIn(repo, 'src/a.ts', { mode })
      expect(auto.decision, mode).toBe('deny')
      expect(auto.reason, mode).toContain(
        `Em ${mode}, a confirmação vira negação`,
      )
    }
  })

  test('unverified: denies when the gate also closed', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({
      branch: BRANCH,
      cache: { verified: false, open: false },
    })
    const run = await editIn(repo, 'src/a.ts')
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain(CLOSED)
  })

  test("pending-plan: asks, critical, for this session's marker, even with the gate open", async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true, marker: SESSION })
    const run = await editIn(repo, 'src/a.ts')
    expect(run.decision).toBe('ask')
    expect(run.reason).toBe(`${io.hookTag} ${PENDING}`)
    const bypass = await editIn(repo, 'src/a.ts', {
      mode: 'bypassPermissions',
    })
    expect(bypass.decision).toBe('deny')
    expect(bypass.reason).toBe(
      `${io.hookTag} ${PENDING} Em bypassPermissions, a confirmação vira negação: faça isso fora desse modo.`,
    )
    const otherSession = await editIn(repo, 'src/a.ts', {
      session: 'another-session',
    })
    expect(otherSession.decision).toBe('pass')
  })

  test('pending-plan: asks with no cache at all, and for an odd session id', async ({
    expect,
    fresh,
  }) => {
    const noCache = await fresh({ branch: BRANCH, marker: SESSION })
    expect((await editIn(noCache, 'src/a.ts')).reason).toContain(PENDING)
    const odd = '../odd/session id'
    const oddRepo = await fresh({ branch: BRANCH, cache: true, marker: odd })
    const run = await editIn(oddRepo, 'src/a.ts', { session: odd })
    expect(run.decision).toBe('ask')
    expect(run.reason).toContain(PENDING)
  })

  test("pending-plan: reads the marker in the repository's common git dir, from any worktree", async ({
    expect,
    fresh,
  }) => {
    // plan-to-issue writes the marker into the common git dir, one place per
    // repository: here written from the main checkout, while the edit is in a
    // linked worktree.
    const repo = await fresh({ marker: SESSION })
    const linked = await repo.addWorktree('linked', BRANCH)
    writeFileSync(
      path.join(linked.gitDir, gateCacheFile),
      openCache(repo.headSha),
    )
    const edit = (session: string, mode = 'default', cwd = repo.dir) =>
      repo
        .run(
          'build-guard',
          toolCall(path.join(linked.dir, 'src/a.ts'), { session, mode, cwd }),
        )
        .then(verdict)
    const run = await edit(SESSION)
    expect(run.decision).toBe('ask')
    expect(run.reason).toBe(`${io.hookTag} ${PENDING}`)
    const bypass = await edit(SESSION, 'bypassPermissions')
    expect(bypass.decision).toBe('deny')
    expect(bypass.reason).toContain(PENDING)
    expect((await edit('another-session')).decision).toBe('pass')

    // A file under a linked worktree's own git dir is not where the marker
    // lives, so it opens nothing and closes nothing.
    const other = await repo.addWorktree('other', 'feature/7-other')
    writeFileSync(path.join(other.gitDir, planPendingFile('moved')), '{}\n')
    expect((await edit('moved', 'default', linked.dir)).decision).toBe('pass')
    // Written from the main checkout by a session that has since moved into
    // the worktree it edits: the common git dir is the same.
    writeFileSync(repo.markerPath('from-main'), '{}\n')
    const fromMain = await edit('from-main', 'default', linked.dir)
    expect(fromMain.decision).toBe('ask')
    expect(fromMain.reason).toContain(PENDING)
  })

  test("pending-plan: reads the marker in the session cwd's own clone of the project", async ({
    expect,
    fresh,
  }) => {
    const target = await fresh({ branch: BRANCH, cache: true })
    const edit = (cwd: string) =>
      target
        .run(
          'build-guard',
          toolCall(path.join(target.dir, 'src/a.ts'), { cwd }),
        )
        .then(verdict)

    const clone = await fresh({ branch: BRANCH, marker: SESSION })
    const run = await edit(clone.dir)
    expect(run.decision).toBe('ask')
    expect(run.reason).toContain(PENDING)
    const elsewhere = await fresh({
      origin: 'https://github.com/someone/else.git',
      marker: SESSION,
    })
    expect((await edit(elsewhere.dir)).decision).toBe('pass')

    // A clone nested inside the target's worktree is its own repository:
    // git stops at its .git, and so does the guard.
    const nested = path.join(target.dir, 'vendor', 'clone')
    mkdirSync(nested, { recursive: true })
    await target.git('-C', nested, 'init', '-q', '-b', 'main')
    await target.git('-C', nested, 'remote', 'add', 'origin', ORIGIN)
    const nestedGitDir = path.join(nested, '.git')
    writeFileSync(path.join(nestedGitDir, planPendingFile(SESSION)), '{}\n')
    const fromNested = await edit(nested)
    expect(fromNested.decision).toBe('ask')
    expect(fromNested.reason).toContain(PENDING)
    expect((await edit(path.join(target.dir, 'vendor'))).decision).toBe('pass')
  })
})

describe.concurrent('the harness', () => {
  test('asks, critical, for every harness path with the gate open', async ({
    expect,
    fresh,
  }) => {
    const samples = [
      '.claude/hooks/build-guard.mjs',
      '.claude/settings.json',
      '.github/workflows/issue-link.yml',
      ...repoLib.harnessPaths.filter((entry) => !entry.endsWith('/')),
    ]
    const repo = await fresh({ branch: BRANCH, cache: true })
    for (const file of samples) {
      const run = await editIn(repo, file)
      expect(run.decision, file).toBe('ask')
      expect(run.reason, file).toContain(HARNESS)
    }
    for (const file of ['scripts/other.mjs', 'src/claude/x.ts', 'github/x.yml'])
      expect((await editIn(repo, file)).decision, file).toBe('pass')
  })

  test('denies a harness path in auto, dontAsk and bypassPermissions', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    for (const mode of io.autonomousModes) {
      const run = await editIn(repo, '.claude/hooks/build-guard.mjs', { mode })
      expect(run.decision, mode).toBe('deny')
      expect(run.reason, mode).toContain(HARNESS)
      expect(run.reason, mode).toContain(
        `Em ${mode}, a confirmação vira negação`,
      )
    }
    for (const mode of ['default', 'acceptEdits', 'plan'])
      expect(
        (await editIn(repo, 'scripts/gate.mjs', { mode })).decision,
        mode,
      ).toBe('ask')
  })

  test('denies a harness path when the gate is not open', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const run = await editIn(repo, '.github/workflows/x.yml')
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain(MISSING)
  })
})

describe.concurrent('the probe of the plan', () => {
  test('denies an Edit in src/ on a claude/x branch cut from main', async ({
    expect,
    fresh,
  }) => {
    const repo = await fresh({ branch: 'claude/x' })
    repo.write({ 'src/main.ts': 'export {}\n' })
    const run = await editIn(repo, 'src/main.ts')
    expect(run.status).toBe(0)
    expect(run.decision).toBe('deny')
    expect(run.reason).toContain(MISSING)
  })
})
