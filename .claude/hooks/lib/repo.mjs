// Which repository a hook is looking at, and the files the loop keeps in its
// git dir: the gate's cache and the pending-plan marker.
//
// The repository is always the one around the target, found from a directory
// (the command's cwd, the file being edited), never from ${CLAUDE_PROJECT_DIR}:
// a session opened in the main checkout edits files in worktrees, and each
// worktree has its own branch and its own gate cache. git runs through argv,
// with -C, never through a shell.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  gateCacheFile,
  planPendingFile,
} from '../../../scripts/loop-sections.mjs'
import { afterSpawn, spawnTimeout } from './budget.mjs'

export const projectRepo = 'geazioliveira/marketo-sandbox'
export const trunk = 'main'

// Variables that would point git at another repository than the one around
// the directory: a hook inherits Claude Code's environment, and a GIT_DIR
// left there (a git hook exports one) must not decide whose rules apply.
// Configuration variables stay, so a test's clean git config still holds.
const discoveryVariables = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
]

/**
 * A git hung on a lock or a network mount must not hold the tool call: each
 * run is bounded, and so is the hook's run as a whole (budget.mjs).
 */
const gitTimeoutMs = 10_000

function gitEnv(env) {
  const clean = { ...env }
  for (const name of discoveryVariables) delete clean[name]
  // English messages, so "not a git repository" can be told from a failure;
  // no optional locks, so reading never competes with the person's git.
  return { ...clean, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
}

function git(dir, args, env) {
  const step = `ler o repositório de ${dir}`
  const timeout = spawnTimeout(gitTimeoutMs, step)
  const run = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: gitEnv(env),
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  afterSpawn(run, gitTimeoutMs, timeout, step)
  if (run.error)
    throw new Error(`git não pôde rodar em ${dir}: ${run.error.message}`)
  return {
    status: run.status,
    out: (run.stdout ?? '').replace(/\n$/, ''),
    err: (run.stderr ?? '').trim(),
  }
}

/**
 * `owner/name`, lowercased, from an origin URL GitHub hands out, or null:
 * HTTPS (with or without a user), the scp form, or ssh://, each with or
 * without `.git` and a trailing slash. GitHub names are case-insensitive, so
 * the identity is compared lowercased.
 */
export function repoFromRemote(url) {
  const matched =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(
      String(url ?? '').trim(),
    )
  return matched ? `${matched[1]}/${matched[2]}`.toLowerCase() : null
}

/**
 * `owner/name`, lowercased, from what `gh -R` takes: `OWNER/REPO`,
 * `github.com/OWNER/REPO`, or a GitHub URL. Another host is another
 * repository, so it gives null, as does anything unreadable.
 */
export function repoFromArg(value) {
  const text = String(value ?? '').trim()
  const bare =
    /^(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)\/?$/i.exec(text)
  if (bare) return `${bare[1]}/${bare[2]}`.toLowerCase()
  return repoFromRemote(text)
}

/**
 * The nearest existing directory at or above a path, for a file that does
 * not exist yet. A path that is an existing file gives its directory.
 */
export function existingDirOf(filePath) {
  let current = path.resolve(String(filePath ?? '.'))
  for (;;) {
    try {
      if (statSync(current).isDirectory()) return current
    } catch {
      // Missing, or unreadable: keep climbing.
    }
    const parent = path.dirname(current)
    if (parent === current) return current
    current = parent
  }
}

/**
 * The real path of a target that may not exist yet: the real path of its
 * nearest existing ancestor, with the missing part added back. git reports
 * real paths (on macOS /tmp is /private/tmp), so a target has to be compared
 * with them in the same form.
 */
export function realPathOf(target) {
  const absolute = path.resolve(String(target ?? '.'))
  let existing = absolute
  const missing = []
  for (;;) {
    try {
      return path.join(realpathSync.native(existing), ...missing.reverse())
    } catch {
      const parent = path.dirname(existing)
      if (parent === existing) return absolute
      missing.push(path.basename(existing))
      existing = parent
    }
  }
}

/**
 * A target's path relative to the repository's top, with `/` separators, or
 * null when it lies outside it. '' is the top itself.
 */
export function repoRelative(repo, target) {
  if (repo?.top == null) return null
  const relative = path.relative(repo.top, realPathOf(target))
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return null
  if (path.isAbsolute(relative)) return null
  return relative.split(path.sep).join('/')
}

/**
 * The worktree a git dir belongs to, for a directory inside one: a linked
 * worktree's admin dir names its `.git` file in `gitdir`, and a main
 * repository's `.git` sits in its worktree. Anything else (a submodule's
 * modules dir, a separate git dir) is not guessed.
 */
function worktreeOfGitDir(gitDir) {
  try {
    const pointer = readFileSync(path.join(gitDir, 'gitdir'), 'utf8').trim()
    if (pointer !== '') return path.dirname(pointer)
  } catch {
    // Not a linked worktree's admin dir.
  }
  if (path.basename(gitDir) === '.git') return path.dirname(gitDir)
  return null
}

/**
 * { top, gitDir, commonDir, branch (null when detached), repo ('owner/name'
 * from origin, lowercased, or null) } | null when not a git worktree.
 * git runs with spawnSync argv and -C dir; never through a shell.
 *
 * A path that does not exist yet is read from its nearest existing
 * directory, where the command that creates it will run. A directory inside
 * a git dir (`.git/hooks`) belongs to that git dir's worktree: editing there
 * is editing the repository, not leaving it. Only git's own "not a git
 * repository" gives null; when git cannot answer (it is missing, it hung, it
 * refused the directory), this throws, so a PreToolUse hook denies instead of
 * reading the silence as "another repository".
 */
export function repoAt(dir, { env = process.env } = {}) {
  const start = existingDirOf(dir)
  const paths = git(
    start,
    [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-dir',
      '--git-common-dir',
    ],
    env,
  )
  let top
  let gitDir
  let commonDir
  if (paths.status === 0) {
    ;[top, gitDir, commonDir] = paths.out.split('\n')
  } else if (/not a git repository/i.test(paths.err)) {
    return null
  } else {
    const inside = git(
      start,
      [
        'rev-parse',
        '--path-format=absolute',
        '--git-dir',
        '--git-common-dir',
        '--is-inside-git-dir',
        '--is-bare-repository',
      ],
      env,
    )
    const [innerGitDir, innerCommonDir, insideGitDir, bare] =
      inside.out.split('\n')
    if (inside.status !== 0)
      throw new Error(`git rev-parse falhou em ${start}: ${paths.err}`)
    if (bare === 'true') return null
    if (insideGitDir !== 'true')
      throw new Error(`git rev-parse falhou em ${start}: ${paths.err}`)
    gitDir = innerGitDir
    commonDir = innerCommonDir
    top = worktreeOfGitDir(gitDir)
    if (top === null)
      throw new Error(
        `não sei a qual worktree pertence o diretório do git ${gitDir}`,
      )
  }
  if (!top || !gitDir || !commonDir)
    throw new Error(`git rev-parse não respondeu por inteiro em ${start}`)

  // Exit 1 is a detached HEAD; anything else is a failure, not a branch.
  // The full ref, not --short: --short prints `heads/main` when a tag named
  // main exists, which no rule would read as the trunk.
  const head = git(start, ['symbolic-ref', '-q', 'HEAD'], env)
  if (head.status !== 0 && head.status !== 1)
    throw new Error(`git symbolic-ref falhou em ${start}: ${head.err}`)
  const branch =
    head.status === 0 && head.out.startsWith('refs/heads/')
      ? head.out.slice('refs/heads/'.length)
      : null

  // Exit 2 is "no such remote"; anything else is a failure.
  const origin = git(start, ['remote', 'get-url', 'origin'], env)
  if (origin.status !== 0 && origin.status !== 2)
    throw new Error(`git remote get-url falhou em ${start}: ${origin.err}`)
  const repo = origin.status === 0 ? repoFromRemote(origin.out) : null

  return { top, gitDir, commonDir, branch, repo }
}

/**
 * True when the repository is this project. It takes the object repoAt
 * returns (its `repo`) or an `owner/name` string (a `-R` value); everything
 * else is another repository, where the hooks pass. Compared lowercased.
 */
export function isProject(repo) {
  const name =
    typeof repo === 'string' ? repoFromArg(repo) : (repo?.repo ?? null)
  return typeof name === 'string' && name.toLowerCase() === projectRepo
}

/** The parsed loop-gate.json under gitDir, or null (missing or unreadable). */
export function readGateCache(gitDir) {
  try {
    const value = JSON.parse(
      readFileSync(path.join(gitDir, gateCacheFile), 'utf8'),
    )
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

/**
 * The git dirs of every worktree of a repository, from its common git dir:
 * the common dir itself (the main worktree's) and each linked worktree's
 * admin dir under `worktrees/`. The gate writes its cache into each.
 */
export function worktreeGitDirs(commonDir) {
  const admin = path.join(commonDir, 'worktrees')
  let linked = []
  try {
    linked = readdirSync(admin, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(admin, entry.name))
  } catch (error) {
    // No linked worktree yet; any other failure is not read as none.
    if (error?.code !== 'ENOENT') throw error
  }
  return [commonDir, ...linked]
}

/**
 * Removes the gate's cache from every worktree of the repository. A removal
 * that fails throws at once, so the caller keeps what it meant to remove
 * after the caches (the plan marker, which every worktree sees).
 */
export function clearGateCaches(commonDir) {
  for (const dir of worktreeGitDirs(commonDir))
    rmSync(path.join(dir, gateCacheFile), { force: true })
}

/**
 * Where session `sessionId`'s pending-plan marker lives: in the git dir
 * given, which plan-to-issue makes the repository's common one.
 */
export function pendingPlanPath(gitDir, sessionId) {
  return path.join(gitDir, planPendingFile(sessionId))
}

/**
 * Whether the marker is there. Only its presence counts, not its content: a
 * marker that cannot be parsed still keeps the cache closed.
 */
export function pendingPlanExists(gitDir, sessionId) {
  return existsSync(pendingPlanPath(gitDir, sessionId))
}

/**
 * Writes the marker whole or not at all: a half-written file would still
 * close the cache, but a reader of its content would see garbage.
 */
export function writePendingPlan(gitDir, sessionId, data) {
  const target = pendingPlanPath(gitDir, sessionId)
  const scratch = `${target}.${process.pid}.tmp`
  writeFileSync(scratch, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(scratch, target)
  return target
}

export function clearPendingPlan(gitDir, sessionId) {
  rmSync(pendingPlanPath(gitDir, sessionId), { force: true })
}

/** Paths, relative to the worktree top, whose edit asks even with the gate open (critical). */
export const harnessPaths = [
  '.claude/',
  '.github/',
  'scripts/gate.mjs',
  'scripts/loop-sections.mjs',
  'scripts/loop-sections.d.mts',
  'scripts/audit-main.mjs',
  'scripts/refresh-issue-link.mjs',
  'scripts/check-context.mjs',
]

/**
 * Whether a path relative to the worktree top is part of the harness. The
 * path is normalized first (`./`, `a/../`, backslashes), and compared without
 * case: macOS's default file system takes `.Claude/settings.json` for
 * `.claude/settings.json`. An entry ending in `/` covers the directory and
 * everything under it.
 */
export function isHarnessPath(relativePath) {
  const text = String(relativePath ?? '').replaceAll('\\', '/')
  if (text === '') return false
  const normalized = path.posix.normalize(text).replace(/^\.\//, '')
  if (normalized.startsWith('../') || normalized.startsWith('/')) return false
  const folded = normalized.toLowerCase()
  return harnessPaths.some((entry) =>
    entry.endsWith('/')
      ? folded === entry.slice(0, -1) || folded.startsWith(entry)
      : folded === entry,
  )
}
