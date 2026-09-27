import { spawn } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GateStep } from '../../scripts/loop-sections.mjs'
import { cleanEnv } from './clean-env'

/** The repository under test (this worktree), whatever directory vitest runs from. */
export const projectRoot = path.resolve(__dirname, '..', '..')
const fakeGh = path.join(projectRoot, 'test', 'support', 'fake-gh.mjs')
const gateFiles = ['gate.mjs', 'loop-sections.mjs']

export const OWNER = 'geazioliveira'
export const NAME = 'marketo-sandbox'
export const ORIGIN = `https://github.com/${OWNER}/${NAME}.git`

export interface GhAnswer {
  number: number
  mode: 'ok' | 'missing' | 'auth' | 'unreachable'
  data?: unknown
}

export interface GhFixture {
  issue?: GhAnswer
  /** The parent issue a slice of a stack is judged by (#31). */
  parent?: GhAnswer
  pr?: GhAnswer
}

export interface GhCall {
  argv: string[]
  kind?: 'issue' | 'pr'
  number?: number
  mode?: string
  violation?: string
}

export interface GateResult {
  schema: number
  mode: 'local' | 'ci'
  repo: string | null
  branch: string | null
  issue: number | null
  headSha: string | null
  open: boolean
  verified: boolean
  steps: GateStep[]
  blocked: string[]
  checkedAt: string
}

export interface Exec {
  status: number | null
  stdout: string
  stderr: string
}

export interface GateRun extends Exec {
  /** stdout and stderr together, for the pt-BR text a person reads. */
  out: string
  calls: GhCall[]
}

export interface RunOptions {
  fixture?: GhFixture
  env?: Record<string, string>
  /** The gate to run; defaults to the copy committed inside the repository. */
  script?: string
  /** Replaces PATH entirely (the fake gh is then absent unless included). */
  pathOverride?: string
}

/**
 * A child process, awaited. Asynchronous on purpose: each spawn costs tens of
 * milliseconds on a machine with endpoint security, and the gate cases only
 * finish in reasonable time when they run concurrently.
 */
export function exec(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<Exec> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

/** Copies the gate and its contracts into `<at>/scripts/`. */
export function installGate(at: string): string {
  const scripts = path.join(at, 'scripts')
  mkdirSync(scripts, { recursive: true })
  for (const file of gateFiles)
    copyFileSync(
      path.join(projectRoot, 'scripts', file),
      path.join(scripts, file),
    )
  return path.join(scripts, 'gate.mjs')
}

/**
 * A throwaway repository shaped like this one: main with AGENTS.md, the gate
 * and an empty changelog, an origin pointing at the real repository name, and
 * refs/remotes/origin/main at main. Nothing is ever fetched or pushed; remote
 * refs are written with update-ref. `remove()` deletes it; the specs call it
 * when each case finishes.
 */
export class TempRepo {
  readonly root: string
  readonly dir: string
  readonly bin: string
  readonly log: string
  readonly fixturePath: string

  private constructor() {
    this.root = mkdtempSync(path.join(tmpdir(), 'gate-spec-'))
    this.dir = path.join(this.root, 'repo')
    this.bin = path.join(this.root, 'bin')
    this.log = path.join(this.root, 'gh.log')
    this.fixturePath = path.join(this.root, 'fixture.json')
    mkdirSync(this.dir, { recursive: true })
    mkdirSync(this.bin, { recursive: true })
    const shim = path.join(this.bin, 'gh')
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeGh)} "$@"\n`,
    )
    chmodSync(shim, 0o755)
  }

  static async create(): Promise<TempRepo> {
    const repo = new TempRepo()
    try {
      await repo.git('init', '-q', '-b', 'main')
      await repo.git('config', 'user.name', 'Gate Spec')
      await repo.git('config', 'user.email', 'gate-spec@example.invalid')
      await repo.git('config', 'commit.gpgsign', 'false')
      await repo.git('remote', 'add', 'origin', ORIGIN)
      installGate(repo.dir)
      await repo.commit(
        {
          'AGENTS.md': '# Roteador\n',
          'context/evolution/changelog.md': '# Changelog\n',
        },
        'Base',
      )
      await repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    } catch (error) {
      repo.remove()
      throw error
    }
    return repo
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true })
  }

  env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return cleanEnv(this.root, { bin: this.bin, extra })
  }

  /** git in the repository; rejects with git's stderr when it fails. */
  async git(...args: string[]): Promise<string> {
    const run = await exec('git', args, { cwd: this.dir, env: this.env() })
    if (run.status !== 0)
      throw new Error(`git ${args.join(' ')} falhou: ${run.stderr}`)
    return run.stdout.trim()
  }

  write(files: Record<string, string>): void {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(this.dir, file)
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

  head(): Promise<string> {
    return this.git('rev-parse', 'HEAD')
  }

  /** What `git push` would leave behind: refs/remotes/origin/<branch> at HEAD. */
  async publish(branch: string): Promise<void> {
    await this.git('update-ref', `refs/remotes/origin/${branch}`, 'HEAD')
  }

  gitDir(): Promise<string> {
    return this.git('rev-parse', '--absolute-git-dir')
  }

  /** Runs the gate as a child process, the way npm run gate and CI do. */
  async gate(args: string[] = [], options: RunOptions = {}): Promise<GateRun> {
    writeFileSync(
      this.fixturePath,
      JSON.stringify({ owner: OWNER, name: NAME, ...options.fixture }),
    )
    rmSync(this.log, { force: true })
    const env = this.env({
      FAKE_GH_LOG: this.log,
      FAKE_GH_FIXTURE: this.fixturePath,
      ...options.env,
    })
    if (options.pathOverride !== undefined) env.PATH = options.pathOverride
    const script = options.script ?? path.join(this.dir, 'scripts', 'gate.mjs')
    const run = await exec(process.execPath, [script, ...args], {
      cwd: this.dir,
      env,
      timeout: 60_000,
    })
    const calls: GhCall[] = existsSync(this.log)
      ? readFileSync(this.log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as GhCall)
      : []
    // The gate sent something the fake does not accept: fail the case here,
    // whatever it asserts, rather than let a refusal pass as a gh error.
    const refused = calls.filter((call) => call.violation !== undefined)
    if (refused.length > 0)
      throw new Error(
        `o gh falso recusou: ${refused.map((call) => call.violation).join('; ')}`,
      )
    return { ...run, out: `${run.stdout}${run.stderr}`, calls }
  }

  /** The gate with --json, parsed. */
  async gateJson(
    args: string[] = [],
    options: RunOptions = {},
  ): Promise<GateRun & { result: GateResult }> {
    const run = await this.gate(['--json', ...args], options)
    try {
      return { ...run, result: JSON.parse(run.stdout) as GateResult }
    } catch {
      throw new Error(`stdout não é JSON (status ${run.status}):\n${run.out}`)
    }
  }
}
