import { spawn, spawnSync } from 'node:child_process'
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
import { pathToFileURL } from 'node:url'
import {
  type GateCache,
  gateCacheFile,
  gateCacheSchema,
  issueFromBranch,
  planPendingFile,
} from '../../scripts/loop-sections.mjs'
import { cleanEnv } from './clean-env'
import { exec, NAME, ORIGIN, OWNER, projectRoot } from './temp-repo'

/**
 * Support for the specs of the Claude Code hooks (#5): run a hook the way
 * Claude Code runs it, as a process with one JSON object on stdin, and build
 * throwaway repositories shaped like this one for it to look at.
 *
 * Nothing here touches the real repository or the real tracker. The
 * repositories live under the system's temp dir, their origin names this
 * project without ever being fetched, and a fake `gh` comes first on PATH.
 */

export const hooksDir = path.join(projectRoot, '.claude', 'hooks')

/** The script of hook `name` (`guard-bash` → .claude/hooks/guard-bash.mjs). */
export const hookPath = (name: string): string =>
  path.join(hooksDir, `${name}.mjs`)

/** The strict fake `gh` for the hooks' live reads, written beside this file. */
export const fakeGhHooks = path.join(
  projectRoot,
  'test',
  'support',
  'fake-gh-hooks.mjs',
)

export const PROJECT = `${OWNER}/${NAME}`

// ---------------------------------------------------------------------------
// Processes

/**
 * Timeouts for the specs, sized for a machine under load. A spec's setup
 * builds git repositories, several processes each, and most cases start a
 * hook as a process that starts git and gh in turn: with the machine busy,
 * either takes far longer than vitest's defaults (10 s for a setup hook, 5 s
 * for a test), and a setup that times out skips every case of its file. A
 * timeout here only turns a slow run into a failure, never a wrong answer
 * into a pass, so they are generous: setupTimeout for beforeAll/beforeEach
 * and the cleanups, processTimeout for a case, spawnTimeout for one process
 * (below processTimeout, so a hung process fails its case with its output).
 */
export const setupTimeout = 120_000
export const processTimeout = 120_000
export const spawnTimeout = 90_000

export interface Spawned {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export interface SpawnOptions {
  /** Written to stdin, then stdin is closed; nothing when undefined. */
  input?: string
  env?: NodeJS.ProcessEnv
  cwd?: string
  timeout?: number
}

/**
 * A child process with stdin written and closed, awaited. Asynchronous, like
 * temp-repo's exec, so cases can run concurrently.
 */
export function spawnWith(
  command: string,
  args: string[],
  { input, env, cwd, timeout = spawnTimeout }: SpawnOptions = {},
): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    // A child that exits before reading its stdin closes the pipe: that is
    // its answer, not the test's error.
    child.stdin.on('error', () => undefined)
    child.on('error', reject)
    child.on('close', (status, signal) =>
      resolve({ status, signal, stdout, stderr }),
    )
    child.stdin.end(input ?? '')
  })
}

/** The git the machine has, for a shim that wraps it. */
export function realGit(): string {
  const run = spawnSync('sh', ['-c', 'command -v git'], {
    encoding: 'utf8',
    timeout: spawnTimeout,
  })
  // A timed-out lookup has status null: say so, not that git is missing.
  if (run.status !== 0)
    throw new Error(
      `command -v git falhou (status ${run.status}): ${run.stderr}`,
    )
  const found = run.stdout.trim()
  if (!path.isAbsolute(found)) throw new Error('git não está no PATH')
  return found
}

/**
 * A directory holding a `git` that runs `before` in sh and then the real git
 * with the same arguments, to put first on a hook's PATH. A `before` that
 * stands for a hung git should `exec sleep`: a sleep started as a child
 * would keep the hook's pipe open after the hook killed the shim.
 */
export function gitShim(dir: string, before: string): string {
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

let sharedRoot: string | null = null

/** A root for the clean environment of runs that bring none. Removed on exit. */
function defaultRoot(): string {
  if (sharedRoot === null) {
    const root = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), 'hooks-spec-')),
    )
    sharedRoot = root
    process.on('exit', () => rmSync(root, { recursive: true, force: true }))
  }
  return sharedRoot
}

/** What a hook prints, as Claude Code reads it. */
export interface HookJson {
  hookSpecificOutput?: {
    hookEventName?: string
    permissionDecision?: string
    permissionDecisionReason?: string
    additionalContext?: string
  }
  [key: string]: unknown
}

export interface HookRun extends Spawned {
  /** stdout parsed, or null when it is empty or not JSON. */
  json: HookJson | null
}

export interface RunHookOptions {
  /** The whole environment; a clean one (clean-env.ts) when absent. */
  env?: NodeJS.ProcessEnv
  /** The process's cwd; the input's `cwd` when it exists, else the temp dir. */
  cwd?: string
  timeout?: number
}

/** The environment a hook runs with when a case gives none. */
export function hookEnv(): NodeJS.ProcessEnv {
  return cleanEnv(defaultRoot())
}

/**
 * Runs hook `name` as Claude Code does: `node .claude/hooks/<name>.mjs`, the
 * input as JSON on stdin (a string is written as it is, to test input that
 * is not JSON).
 */
export async function runHook(
  name: string,
  input: unknown,
  { env, cwd, timeout }: RunHookOptions = {},
): Promise<HookRun> {
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  const inputCwd =
    input !== null && typeof input === 'object' && 'cwd' in input
      ? (input as { cwd?: unknown }).cwd
      : undefined
  const run = await spawnWith(process.execPath, [hookPath(name)], {
    input: text,
    env: env ?? hookEnv(),
    cwd:
      cwd ??
      (typeof inputCwd === 'string' && existsSync(inputCwd)
        ? inputCwd
        : tmpdir()),
    timeout,
  })
  let json: HookJson | null = null
  const out = run.stdout.trim()
  if (out !== '')
    try {
      json = JSON.parse(out) as HookJson
    } catch {
      json = null
    }
  return { ...run, json }
}

// ---------------------------------------------------------------------------
// The libraries, loaded as the hooks load them

export interface SimpleCommand {
  argv: string[]
  env: Record<string, string>
  cwd: string | null
  stdin: string | null
  text: string
  known: boolean[]
  stdinKnown: boolean
  stdinFile: string | null
  /** Redirections other than heredocs, targets filled in like the words. */
  redirs?: {
    op: string
    fd: string | null
    target: { value: string; known: boolean }
  }[]
  /**
   * The standalone assignments (`HOME=/x;`) since the command before it, not
   * enumerable: recordAssignments reads them.
   */
  assignedBefore?: { name: string; value: string; known: boolean }[]
}

export interface ParsedCommand {
  commands: SimpleCommand[]
  unparsable: boolean
  substitution: boolean
}

export interface OptionFound {
  name: string
  value: string
  index: number
}

export interface BodyPart {
  known: boolean
  text: string | null
  source: string
}

export interface BodyRead extends BodyPart {
  all: BodyPart[]
}

export interface ShellLib {
  parseCommand(text: unknown): ParsedCommand
  findOptions(
    argv: readonly string[],
    names: readonly string[],
    options?: { abbreviations?: boolean },
  ): OptionFound[]
  optionValues(
    argv: readonly string[],
    names: readonly string[],
    options?: { abbreviations?: boolean },
  ): string[]
  readBody(
    command: Partial<SimpleCommand> & { argv: string[] },
    baseCwd: string,
    options?: {
      bodyFlags?: string[]
      fileFlags?: string[]
      unknownFlags?: string[]
    },
  ): BodyRead
  recordExports(
    command: Partial<SimpleCommand> & { argv: string[] },
    exported: Record<string, string>,
  ): void
  recordAssignments(
    command: Partial<SimpleCommand>,
    exported: Record<string, string>,
  ): void
}

export interface Decision {
  decision: 'deny' | 'ask' | 'pass'
  reason?: string
  critical?: boolean
}

export interface IoLib {
  hookTag: string
  autonomousModes: readonly string[]
  readInput(
    stream?: AsyncIterable<unknown>,
  ): Promise<Record<string, unknown> | null>
  pass(): Decision
  deny(reason: string): Decision
  ask(reason: string, options?: { critical?: boolean }): Decision
  combine(decisions: readonly unknown[]): Decision
  resolve(decision: Decision, permissionMode?: string): Decision
  preToolUseOutput(decision: unknown): string
  contextOutput(event: string, text: string): string
}

/** .claude/hooks/lib/budget.mjs: one time budget for a whole run of a hook. */
export interface BudgetLib {
  hookBudgetsMs: Readonly<Record<string, number>>
  budgetVariable: string
  gitTimeoutVariable: string
  gitTimeoutMs(env?: Record<string, string | undefined>): number
  BudgetExhausted: new (
    step: string,
    budgetMs: number | null,
  ) => Error & { budgetMs: number | null }
  startBudget(name: string, env?: Record<string, string | undefined>): number
  holdBack(ms: number): number
  releaseHeld(): number
  remainingMs(): number
  checkBudget(step: string): void
  spawnTimeout(ownMs: number, step: string): number
  afterSpawn(
    run: { error?: { code?: string } | null; signal?: string | null } | null,
    ownMs: number,
    usedMs: number,
    step: string,
  ): void
}

export interface RepoInfo {
  top: string
  gitDir: string
  commonDir: string
  branch: string | null
  repo: string | null
}

export interface RepoLib {
  projectRepo: string
  trunk: string
  repoAt(dir: string, options?: { env?: NodeJS.ProcessEnv }): RepoInfo | null
  existingDirOf(filePath: string): string
  realPathOf(target: string): string
  placeOf(
    start: string,
    options?: {
      followLast?: boolean
      lineLink?: ((next: string) => string | null) | null
    },
  ): string
  Unplaceable: new (message: string) => Error
  repoRelative(repo: RepoInfo, target: string): string | null
  repoFromRemote(url: string): string | null
  repoFromArg(value: string): string | null
  isProject(repo: RepoInfo | string | null | undefined): boolean
  readGateCache(gitDir: string): Record<string, unknown> | null
  worktreeGitDirs(commonDir: string): string[]
  clearGateCaches(commonDir: string): void
  pendingPlanPath(gitDir: string, sessionId: unknown): string
  pendingPlanExists(gitDir: string, sessionId: unknown): boolean
  writePendingPlan(gitDir: string, sessionId: unknown, data: unknown): string
  clearPendingPlan(gitDir: string, sessionId: unknown): void
  harnessPaths: readonly string[]
  isHarnessPath(relativePath: string): boolean
  gitConfigVariable: RegExp
  commandGitConfig(
    overrides: Record<string, string>,
    inherited?: NodeJS.ProcessEnv,
    cwd?: string | null,
  ):
    | { set: false }
    | { set: true; known: false; why: string }
    | { set: true; known: true; env: NodeJS.ProcessEnv; what: string }
  configuredRemote(
    repo: { top?: string | null; gitDir: string },
    env: NodeJS.ProcessEnv,
  ): { known: true; repo: string | null } | { known: false; why: string }
}

/**
 * A library of .claude/hooks/lib, imported by URL. The libraries are plain
 * .mjs with no declarations, so the specs type them with the interfaces
 * above rather than widen tsconfig to JavaScript.
 */
export function loadHookLib<T>(name: string): Promise<T> {
  return import(
    pathToFileURL(path.join(hooksDir, 'lib', `${name}.mjs`)).href
  ) as Promise<T>
}

// ---------------------------------------------------------------------------
// Repositories

export interface HookRepoOptions {
  /** Checked out after the commit on main; main when absent. */
  branch?: string
  /** HEAD detached at main's commit instead of on a branch. */
  detached?: boolean
  /** The origin URL; the project's by default, none with null. */
  origin?: string | null
  /** Writes loop-gate.json into the git dir, with checkedAt now; an object overrides fields. */
  cache?: boolean | Partial<GateCache>
  /** Writes a pending-plan marker for this session id (or { sessionId, data }). */
  marker?: string | { sessionId: string; data?: Record<string, unknown> }
  /** The fake gh put first on PATH: its script and the fixture it answers from. */
  fakeGh?: { script?: string; fixture?: unknown }
}

/**
 * A throwaway repository for a hook to look at: main with one commit, an
 * origin naming this project, and a fake `gh` first on PATH with
 * FAKE_GH_FIXTURE and FAKE_GH_LOG set. Every path is a real path (on macOS
 * the temp dir is behind /private), as git reports them.
 */
export class HookRepo {
  readonly root: string
  readonly dir: string
  readonly bin: string
  readonly log: string
  readonly fixturePath: string
  gitDir = ''
  headSha = ''
  branch: string | null = 'main'

  private constructor(fakeGh: { script?: string; fixture?: unknown }) {
    this.root = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), 'hooks-spec-')),
    )
    this.dir = path.join(this.root, 'repo')
    this.bin = path.join(this.root, 'bin')
    this.log = path.join(this.root, 'gh.log')
    this.fixturePath = path.join(this.root, 'fixture.json')
    mkdirSync(this.dir, { recursive: true })
    mkdirSync(this.bin, { recursive: true })
    const shim = path.join(this.bin, 'gh')
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeGh.script ?? fakeGhHooks)} "$@"\n`,
    )
    chmodSync(shim, 0o755)
    this.setFixture(fakeGh.fixture ?? {})
  }

  static async create(options: HookRepoOptions = {}): Promise<HookRepo> {
    const repo = new HookRepo(options.fakeGh ?? {})
    try {
      // Few spawns on purpose: each costs tens of milliseconds or more on a
      // machine with endpoint security. The identity comes from the
      // environment (gitEnv) and the global config is empty (clean-env.ts).
      await repo.git('init', '-q', '-b', 'main')
      const origin = options.origin === undefined ? ORIGIN : options.origin
      if (origin !== null) await repo.git('remote', 'add', 'origin', origin)
      await repo.commit({ 'README.md': '# Repositório de teste\n' }, 'Base')
      if (options.detached) {
        await repo.git('checkout', '-q', '--detach')
        repo.branch = null
      } else if (options.branch !== undefined && options.branch !== 'main') {
        await repo.git('checkout', '-q', '-b', options.branch)
        repo.branch = options.branch
      }
      ;[repo.headSha, repo.gitDir] = (
        await repo.git('rev-parse', 'HEAD', '--absolute-git-dir')
      ).split('\n')
      if (options.cache)
        repo.writeCache(options.cache === true ? {} : options.cache)
      if (options.marker !== undefined) {
        const marker =
          typeof options.marker === 'string'
            ? { sessionId: options.marker }
            : options.marker
        repo.writeMarker(marker.sessionId, marker.data)
      }
    } catch (error) {
      repo.remove()
      throw error
    }
    return repo
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true })
  }

  /** A clean environment with the fake gh first on PATH and its variables set. */
  env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return cleanEnv(this.root, {
      bin: this.bin,
      extra: {
        FAKE_GH_FIXTURE: this.fixturePath,
        FAKE_GH_LOG: this.log,
        ...extra,
      },
    })
  }

  /** The environment git runs with here: this.env() and a fixed identity. */
  gitEnv(): NodeJS.ProcessEnv {
    return this.env({
      GIT_AUTHOR_NAME: 'Hooks Spec',
      GIT_AUTHOR_EMAIL: 'hooks-spec@example.invalid',
      GIT_COMMITTER_NAME: 'Hooks Spec',
      GIT_COMMITTER_EMAIL: 'hooks-spec@example.invalid',
    })
  }

  /** git in the repository; rejects with git's stderr when it fails. */
  async git(...args: string[]): Promise<string> {
    const run = await exec('git', args, {
      cwd: this.dir,
      env: this.gitEnv(),
      timeout: spawnTimeout,
    })
    if (run.status !== 0)
      throw new Error(`git ${args.join(' ')} falhou: ${run.stderr}`)
    return run.stdout.trim()
  }

  write(files: Record<string, string>, at: string = this.dir): void {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(at, file)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
  }

  /** Writes the files and commits everything. */
  async commit(files: Record<string, string>, message: string): Promise<void> {
    this.write(files)
    await this.git('add', '-A')
    await this.git('commit', '-q', '--allow-empty', '-m', message)
  }

  setFixture(fixture: unknown): void {
    writeFileSync(this.fixturePath, JSON.stringify(fixture))
  }

  /** The fake gh's log, one parsed line per call (a line that is not JSON stays text). */
  calls(): unknown[] {
    if (!existsSync(this.log)) return []
    return readFileSync(this.log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          return line
        }
      })
  }

  /** loop-gate.json as the gate writes it, open and verified for this branch, checked now. */
  writeCache(overrides: Partial<GateCache> = {}): GateCache {
    const cache: GateCache = {
      schema: gateCacheSchema,
      repo: PROJECT,
      branch: this.branch,
      issue: issueFromBranch(this.branch),
      headSha: this.headSha,
      open: true,
      verified: true,
      steps: [],
      checkedAt: new Date().toISOString(),
      ...overrides,
    }
    writeFileSync(
      path.join(this.gitDir, gateCacheFile),
      `${JSON.stringify(cache, null, 2)}\n`,
    )
    return cache
  }

  markerPath(sessionId: string, gitDir: string = this.gitDir): string {
    return path.join(gitDir, planPendingFile(sessionId))
  }

  /** A pending-plan marker for the session, as plan-to-issue writes one. */
  writeMarker(sessionId: string, data?: Record<string, unknown>): string {
    const file = this.markerPath(sessionId)
    writeFileSync(
      file,
      `${JSON.stringify(
        data ?? {
          schema: 1,
          sessionId,
          branch: this.branch,
          acceptedAt: new Date().toISOString(),
          planFilePath: null,
          planHead: '# Plano',
        },
        null,
        2,
      )}\n`,
    )
    return file
  }

  /** A linked worktree beside the repository, on a new branch cut from HEAD. */
  async addWorktree(
    name: string,
    branch: string,
  ): Promise<{ dir: string; gitDir: string }> {
    const dir = path.join(this.root, name)
    await this.git('worktree', 'add', '-q', '-b', branch, dir)
    const run = await exec('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: dir,
      env: this.gitEnv(),
      timeout: spawnTimeout,
    })
    if (run.status !== 0)
      throw new Error(`git rev-parse falhou em ${dir}: ${run.stderr}`)
    return { dir, gitDir: run.stdout.trim() }
  }

  /**
   * Runs a hook against this repository: the input's `cwd` defaults to the
   * repository, and so do the process's cwd and environment.
   */
  run(
    name: string,
    input: unknown,
    options: RunHookOptions = {},
  ): Promise<HookRun> {
    const withCwd =
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      !('cwd' in input)
        ? { ...input, cwd: this.dir }
        : input
    return runHook(name, withCwd, {
      env: options.env ?? this.env(),
      cwd: options.cwd ?? this.dir,
      timeout: options.timeout,
    })
  }
}

/** HookRepo.create: a temp repository for the hooks, per the spec's `hookRepo({ branch, cache, marker })`. */
export function hookRepo(options: HookRepoOptions = {}): Promise<HookRepo> {
  return HookRepo.create(options)
}
