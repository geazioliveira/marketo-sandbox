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
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
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
import { afterSpawn, gitTimeoutMs, spawnTimeout } from './budget.mjs'

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

function gitEnv(env) {
  const clean = { ...env }
  for (const name of discoveryVariables) delete clean[name]
  // English messages, so "not a git repository" can be told from a failure;
  // no optional locks, so reading never competes with the person's git.
  return { ...clean, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
}

function git(dir, args, env) {
  const step = `ler o repositório de ${dir}`
  // A git hung on a lock or a network mount must not hold the tool call:
  // each run is bounded (10 s, or LOOP_HOOKS_GIT_TIMEOUT_MS), and so is the
  // hook's run as a whole (budget.mjs).
  const own = gitTimeoutMs()
  const timeout = spawnTimeout(own, step)
  const run = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: gitEnv(env),
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  afterSpawn(run, own, timeout, step)
  // The cause keeps the spawn's code: session-context tells a git that did
  // not answer in time (ETIMEDOUT) from one that could not start.
  if (run.error)
    throw new Error(`git não pôde rodar em ${dir}: ${run.error.message}`, {
      cause: run.error,
    })
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

// ---------------------------------------------------------------------------
// Where a write lands, through links
//
// build-guard places the file an edit writes, and guard-bash the files a
// shell command writes (Copilot review of #26, eighth round): one reading of
// the links for both.

/** Links followed while placing one path, as Linux's MAXSYMLINKS. */
const maxLinks = 40

/** A path that could not be placed; the message is the reason. */
export class Unplaceable extends Error {}

/**
 * Where an absolute path lands, resolved the way the kernel resolves it for
 * an open: name by name, `..` taken from the directory reached so far (so
 * `link/..` is the link target's parent, not the link's), every symlink
 * followed, dangling ones included, since opening a dangling link to write
 * creates its target. Names that do not exist yet are kept as written.
 * With `followLast` false the last name is not followed: that is the entry
 * a program replaces or removes, which counts as itself when it is a link.
 *
 * `lineLink`, when given, answers first for each name reached: the
 * destination of a link a command line made before the command being judged
 * (guard-bash), which is not on disk while the hook reads it, or null to
 * read the disk. A relative destination is read from the link's own
 * directory, as a symlink's is. It may throw, for a link whose destination
 * is not known.
 *
 * git reports real paths, so the part that exists is then written the way
 * the disk has it (on macOS, /tmp is /private/tmp and case is the disk's).
 * @throws {Unplaceable} for a name it cannot read, or more than maxLinks links
 */
export function placeOf(start, { followLast = true, lineLink = null } = {}) {
  const pending = String(start).split('/').reverse()
  let current = '/'
  let links = 0
  while (pending.length > 0) {
    const name = pending.pop()
    if (name === '' || name === '.') continue
    if (name === '..') {
      current = path.dirname(current)
      continue
    }
    const next = path.join(current, name)
    const last = pending.every((rest) => rest === '' || rest === '.')
    let destination = typeof lineLink === 'function' ? lineLink(next) : null
    if (destination === null) {
      let stats
      try {
        stats = lstatSync(next)
      } catch (error) {
        const code = error?.code
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          current = next
          continue
        }
        throw new Unplaceable(
          `não consegui ler ${next} (${code ?? String(error)}) para saber onde a escrita cai`,
        )
      }
      if (!stats.isSymbolicLink() || (last && !followLast)) {
        current = next
        continue
      }
      try {
        destination = readlinkSync(next)
      } catch (error) {
        throw new Unplaceable(
          `link simbólico que não consegui seguir: ${next} (${error?.code ?? String(error)})`,
        )
      }
    } else if (last && !followLast) {
      current = next
      continue
    }
    links += 1
    if (links > maxLinks)
      throw new Unplaceable(
        `link simbólico que não consegui seguir: mais de ${maxLinks} links a partir de ${start}`,
      )
    if (path.isAbsolute(destination)) current = '/'
    pending.push(...destination.split('/').reverse())
  }
  if (followLast) return realPathOf(current)
  return current === '/'
    ? current
    : path.join(realPathOf(path.dirname(current)), path.basename(current))
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

// ---------------------------------------------------------------------------
// The git config a command gives gh (Copilot review of #26, seventh round)
//
// gh picks its repository from the remotes git reports, and git reads them
// from the config the environment points it at. repoAt reads them with the
// environment the hook inherited, which is the one a command inherits too;
// a command that sets any of the variables below on itself, or exports them
// earlier on the line, gives gh a config the hook did not read: another
// `remote.origin.url`, a `url.<base>.insteadOf` that rewrites it, a global
// config in another HOME. Such a command is read again with exactly its
// environment, and only a config the hook can take in full counts.

/**
 * The variables that decide which git config a process reads: the `-c`
 * git takes from the environment (GIT_CONFIG_COUNT with its
 * GIT_CONFIG_KEY_<n> and GIT_CONFIG_VALUE_<n>, and GIT_CONFIG_PARAMETERS),
 * the files it reads (GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM,
 * GIT_CONFIG_NOSYSTEM, and HOME and XDG_CONFIG_HOME, where the global
 * config lives), and GIT_CONFIG, which points `git config`, and so gh's read
 * of its `gh-resolved` keys, at another file.
 */
export const gitConfigVariable =
  /^(?:GIT_CONFIG(?:_(?:COUNT|PARAMETERS|GLOBAL|SYSTEM|NOSYSTEM|KEY_\d+|VALUE_\d+))?|HOME|XDG_CONFIG_HOME)$/

/** Of those, the ones that hold a path, which git resolves from its own cwd. */
const gitConfigPaths = new Set([
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'HOME',
  'XDG_CONFIG_HOME',
])

/**
 * The git config environment a command runs with, when it is not the one
 * the hook inherited: `overrides` are the variables the command sets (on
 * itself, or exported earlier on the line), `inherited` the hook's own
 * environment, `cwd` the directory the command runs in.
 * - { set: false } when no variable of gitConfigVariable differs from what
 *   the hook inherited (unset and empty count as the same);
 * - { set: true, known: false, why } when one of them cannot be read: an
 *   expansion, an empty value (the parser gives `unset NAME` as empty, and
 *   git reads an empty HOME as `/`), a path starting with `~`, a relative
 *   path with no directory to read it from, or GIT_CONFIG set at all;
 * - { set: true, known: true, env, what } otherwise: the hook's environment
 *   with the command's values over it, each path made absolute from `cwd`,
 *   as the gh the command starts would hand them to git.
 */
export function commandGitConfig(
  overrides,
  inherited = process.env,
  cwd = null,
) {
  const given = overrides ?? {}
  const names = Object.keys(given)
    .filter(
      (name) =>
        gitConfigVariable.test(name) &&
        String(given[name] ?? '') !== String(inherited?.[name] ?? ''),
    )
    .sort()
  if (names.length === 0) return { set: false }
  const what = `o comando dá ao git uma configuração própria (${names.join(', ')})`
  const unknown = (detail) => ({
    set: true,
    known: false,
    why: `${what}, e ${detail}`,
  })
  const env = { ...inherited }
  for (const name of names) {
    const value = String(given[name] ?? '')
    if (/[$`]/.test(value)) return unknown(`${name} traz uma expansão`)
    if (value === '')
      return unknown(`não sei se ${name} fica vazia ou deixa de existir`)
    if (gitConfigPaths.has(name) && !path.isAbsolute(value)) {
      if (value.startsWith('~'))
        return unknown(`${name} começa com ~, que o hook não expande`)
      if (typeof cwd !== 'string' || cwd === '')
        return unknown(`${name} é relativa a um diretório que não li`)
      env[name] = path.resolve(cwd, value)
    } else env[name] = value
  }
  if (typeof env.GIT_CONFIG === 'string' && env.GIT_CONFIG !== '')
    return unknown(
      'GIT_CONFIG leva o git config que o gh roda a outro arquivo, que o hook não segue',
    )
  return { set: true, known: true, env, what }
}

const configuredRemotes = new Map()

/**
 * The repository gh picks from the remotes of `repo` (repoAt of the place
 * the command's gh finds its repository from) when the command gives git
 * the environment `env` (commandGitConfig's): read with exactly that
 * environment, through argv, bounded by the run's budget, once per git dir
 * and config. Only a config the hook reads in full counts; anything gh or
 * git could resolve in a way the hook does not follow leaves it unknown:
 * - an include (`include.path`, `includeIf.<cond>.path`), which brings
 *   another file, perhaps only under a condition;
 * - a rewriting of URLs (`url.<base>.insteadOf` or `pushInsteadOf`);
 * - a default repository of gh (`remote.<name>.gh-resolved`);
 * - a remote other than origin, which gh may pick before it;
 * - a push URL of origin, which gh may read in place of its URL;
 * - origin's URLs naming more than one repository (a `remote.origin.url`
 *   given through the environment adds a URL, and does not replace the
 *   one on disk);
 * - a config git itself refuses (a GIT_CONFIG_COUNT with a key missing).
 * @returns {{ known: true, repo: string | null } | { known: false, why: string }}
 */
export function configuredRemote(repo, env) {
  const key = JSON.stringify([
    repo.gitDir,
    Object.entries(env)
      .filter(([name]) => gitConfigVariable.test(name))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ])
  if (!configuredRemotes.has(key))
    configuredRemotes.set(key, readConfiguredRemote(repo, env))
  return configuredRemotes.get(key)
}

function readConfiguredRemote(repo, env) {
  const run = git(
    repo.top ?? repo.gitDir,
    ['--git-dir', repo.gitDir, 'config', '--list', '-z'],
    env,
  )
  if (run.status !== 0)
    return {
      known: false,
      why: `o git recusou essa configuração (${run.err || `saída ${run.status}`})`,
    }
  const origins = new Set()
  for (const entry of run.out.split('\0')) {
    if (entry === '') continue
    const nl = entry.indexOf('\n')
    const key = nl < 0 ? entry : entry.slice(0, nl)
    const value = nl < 0 ? '' : entry.slice(nl + 1)
    const first = key.indexOf('.')
    const last = key.lastIndexOf('.')
    const section = key.slice(0, first).toLowerCase()
    const name = key.slice(last + 1).toLowerCase()
    const subsection = last > first ? key.slice(first + 1, last) : ''
    if (section === 'include' || section === 'includeif')
      return { known: false, why: `ela inclui outro arquivo (${key})` }
    if (section === 'url' && (name === 'insteadof' || name === 'pushinsteadof'))
      return { known: false, why: `ela reescreve URLs (${key})` }
    if (section !== 'remote' || subsection === '') continue
    if (name === 'gh-resolved')
      return {
        known: false,
        why: `ela dá ao gh um repositório padrão (${key})`,
      }
    if (name !== 'url' && name !== 'pushurl') continue
    if (subsection !== 'origin')
      return {
        known: false,
        why: `ela tem outro remote além do origin (${subsection}), que o gh pode escolher`,
      }
    if (name === 'pushurl')
      return { known: false, why: `o origin tem uma URL de push própria` }
    origins.add(repoFromRemote(value))
  }
  if (origins.size > 1)
    return {
      known: false,
      why: 'o origin aponta para mais de um repositório',
    }
  return { known: true, repo: origins.size === 0 ? null : [...origins][0] }
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
 * close the cache, but a reader of its content would see garbage. A write
 * that fails throws, and leaves no scratch file behind.
 */
export function writePendingPlan(gitDir, sessionId, data) {
  const target = pendingPlanPath(gitDir, sessionId)
  const scratch = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(scratch, `${JSON.stringify(data, null, 2)}\n`)
    renameSync(scratch, target)
  } catch (error) {
    rmSync(scratch, { force: true })
    throw error
  }
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
