// The build guard (#5): a PreToolUse hook on Edit, Write and NotebookEdit.
//
// Building starts only once the gate is open for the branch: the owner's
// Approve read, the issue in ready-for-agent, the branch cut for it. The gate
// leaves that verdict in loop-gate.json, under the worktree's git dir, and
// this hook reads it before every file the agent writes in this project.
// context/intent/ is the exception, since the intent is written before the
// gate can open; so are files the repository's own .gitignore files ignore,
// which never reach a commit, outside the harness. main is never edited, and
// neither is the git dir or the owner's emergency exit. A path is judged
// where the write lands, through every symlink, dangling ones included.
//
// The repository is the one around the file, never ${CLAUDE_PROJECT_DIR}: a
// session opened in the main checkout edits files in worktrees, and each
// worktree has its own branch and its own gate cache.
//
// The libraries are imported inside the try, not at the top: a module that
// fails to load would end the process with exit 1, which Claude Code reads
// as a non-blocking error and lets the edit through. When io.mjs itself
// cannot load, there is no JSON to print, so the hook exits 2, which blocks.
import { spawnSync } from 'node:child_process'
import { lstatSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const gitDirReason = 'o diretório do git não se edita à mão'
const pendingPlanReason =
  'há um plano aceito nesta sessão e ainda não publicado numa issue: publique-o antes de construir'
const rerunGate = 'rode npm run gate na branch antes de editar'
const closedReason =
  'o gate está fechado: rode npm run gate e resolva o que ele aponta'

/** The owner's emergency exit (disableAllHooks lives there), at any depth. */
const settingsLocal = '.claude/settings.local.json'

/** Where the intent is written, before the gate can open. */
const intentDir = 'context/intent/'

// repo.mjs keeps its git runner to itself, so the one git call made here
// repeats its hygiene: no variable a git hook leaves in Claude Code's
// environment may point git at another repository, the messages are in
// English, and reading takes no optional lock.
const discoveryVariable =
  /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|NAMESPACE|PREFIX)$/
const gitTimeoutMs = 10_000

// Claude Code kills a hook past its timeout (90 s in settings.json), and a
// killed hook is a non-blocking error: the edit goes through. Each git call
// is bounded on its own, but a run makes several, so the run as a whole has
// a budget too (budget.mjs), shared by every git it starts, repoAt's
// included: each one's timeout is what is left of it at most. Past it, the
// hook asks, critical, instead of racing the kill (Copilot review of #26).

/** Links followed while placing one path, as Linux's MAXSYMLINKS. */
const maxLinks = 40

function gitEnv() {
  const env = {}
  for (const [name, value] of Object.entries(process.env))
    if (!discoveryVariable.test(name)) env[name] = value
  return { ...env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
}

/**
 * Folds a name the way macOS's default file system compares names, and a
 * little further: case-insensitive with Unicode's full folding, so
 * `.claude/ſettings.local.json` (a long s) is the owner's file there, and
 * compatibility forms (the Kelvin sign) are their letters. Folding too much
 * only refuses more.
 */
function fold(text) {
  return text.normalize('NFKC').toUpperCase().toLowerCase()
}

/**
 * Whether one of the repository's own .gitignore files ignores the path.
 *
 * Only a clean match (exit 0) of a pattern that is not a negation, read from
 * a `.gitignore` inside the worktree, counts. The other sources git reads
 * are writable without touching a tracked file: the global excludes file
 * lives outside any repository, where this guard lets everything through,
 * and info/exclude is one shell command away. A tracked `.gitignore` changes
 * only through an edit the gate judges. core.excludesFile is also pointed
 * at nothing, so a relative one named like a .gitignore cannot pose as one.
 *
 * A failure, a timeout or a path git refuses is read as not ignored, so the
 * file falls through to the gate. check-ignore reads the index, so a tracked
 * file is never ignored, even when a pattern matches it.
 */
function isIgnored(top, relative, budget) {
  if (relative === '') return false
  const step = 'conferir o .gitignore'
  const timeout = budget.spawnTimeout(gitTimeoutMs, step)
  const run = spawnSync(
    'git',
    [
      '-C',
      top,
      '-c',
      'core.excludesFile=/dev/null',
      'check-ignore',
      '--verbose',
      '-z',
      '--stdin',
    ],
    {
      encoding: 'utf8',
      env: gitEnv(),
      input: `${relative}\0`,
      timeout,
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  )
  budget.afterSpawn(run, gitTimeoutMs, timeout, step)
  if (run.error !== undefined || run.status !== 0) return false
  // --verbose -z prints source, line, pattern and path, each ended by NUL.
  const [source = '', , pattern = ''] = String(run.stdout ?? '').split('\0')
  if (pattern === '' || pattern.startsWith('!')) return false
  if (source === '' || path.isAbsolute(source)) return false
  const parts = source.split('/')
  return (
    parts.at(-1) === '.gitignore' &&
    !parts.some((part) => part === '..' || fold(part) === '.git')
  )
}

/**
 * A path relative to a directory, with `/` separators, or null when it lies
 * outside. '' is the directory itself. Both sides are real paths already.
 */
function within(dir, target) {
  const relative = path.relative(dir, target)
  if (relative === '') return ''
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return null
  return relative.split(path.sep).join('/')
}

/**
 * The paths the tool call names. Edit and Write take file_path, NotebookEdit
 * takes notebook_path; both are read whatever the tool, so a call that
 * carries both is judged on both.
 */
function namedPaths(input) {
  const toolInput = input.tool_input
  if (toolInput === null || typeof toolInput !== 'object') return []
  return ['file_path', 'notebook_path']
    .map((key) => toolInput[key])
    .filter((value) => typeof value === 'string' && value.trim() !== '')
}

/** A path that could not be placed; the reason is the refusal. */
class Unplaceable extends Error {}

/**
 * Where an absolute path lands, resolved the way the kernel resolves it for
 * an open: name by name, `..` taken from the directory reached so far (so
 * `link/..` is the link target's parent, not the link's), every symlink
 * followed, dangling ones included, since opening a dangling link to write
 * creates its target. Names that do not exist yet are kept as written.
 * With `followLast` false the last name is not followed: that is the entry
 * the tool edits, which counts as itself when it is a link.
 *
 * git reports real paths, so the part that exists is then written the way
 * the disk has it (on macOS, /tmp is /private/tmp and case is the disk's).
 */
function placeOf(start, { followLast, realPathOf }) {
  const pending = start.split('/').reverse()
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
    const last = pending.every((rest) => rest === '' || rest === '.')
    if (!stats.isSymbolicLink() || (last && !followLast)) {
      current = next
      continue
    }
    links += 1
    if (links > maxLinks)
      throw new Unplaceable(
        `link simbólico que não consegui seguir: mais de ${maxLinks} links a partir de ${start}`,
      )
    let destination
    try {
      destination = readlinkSync(next)
    } catch (error) {
      throw new Unplaceable(
        `link simbólico que não consegui seguir: ${next} (${error?.code ?? String(error)})`,
      )
    }
    if (path.isAbsolute(destination)) current = '/'
    pending.push(...destination.split('/').reverse())
  }
  if (followLast) return realPathOf(current)
  return current === '/'
    ? current
    : path.join(realPathOf(path.dirname(current)), path.basename(current))
}

/**
 * Every place a named path may write to, as real paths, or the refusal for
 * a path that could not be placed. The tools expect absolute paths; a
 * relative one is resolved against the input's cwd, as the spec says.
 * Claude Code's file tools expand a leading `~` to the home directory, so a
 * tilde path is also judged there: the side that restricts, since a file
 * judged in two places must pass in both.
 *
 * Each spelling is taken as written (`..` resolved on the disk) and
 * normalized (`..` removed as text first), since which one the tool opens is
 * not ours to know. Each is placed twice: the entry itself, so a
 * .claude/settings.local.json that is a symlink still counts as itself, and
 * where the bytes land, so a link outside the repository that points into
 * it, dangling or not, is judged inside.
 */
function targetsOf(named, cwd, realPathOf) {
  const spellings = []
  for (const raw of named) {
    const written = path.isAbsolute(raw) ? raw : `${cwd}/${raw}`
    spellings.push(written, path.resolve(written))
    if (raw === '~' || raw.startsWith('~/')) {
      const home = homedir()
      spellings.push(`${home}/${raw.slice(2)}`, path.join(home, raw.slice(2)))
    }
  }
  const targets = new Map()
  for (const spelling of new Set(spellings))
    for (const followLast of [false, true]) {
      try {
        const target = placeOf(spelling, { followLast, realPathOf })
        targets.set(`path:${target}`, { target })
      } catch (error) {
        if (!(error instanceof Unplaceable)) throw error
        targets.set(`error:${error.message}`, { refusal: error.message })
      }
    }
  return [...targets.values()]
}

/**
 * Whether this session has a plan it accepted and has not published.
 * plan-to-issue writes the marker into the common git dir of the session's
 * repository, one place per repository whatever worktree the session is in,
 * named for the session. So the target's common git dir counts, and so does
 * the common git dir of a session cwd in another clone of this project.
 */
function hasPendingPlan(found, input, { repo, repoAt, realPathOf }) {
  const marked = (dir) => repo.pendingPlanExists(dir, input.session_id)
  if (marked(found.commonDir)) return true

  // The session's own repository. git runs only when the cwd may lie in
  // another one: a cwd inside the target's worktree with no `.git` between
  // them is that worktree, whose common git dir was just read.
  const cwd = typeof input.cwd === 'string' ? input.cwd : ''
  if (!path.isAbsolute(cwd)) return false
  if (insideWorktree(realPathOf(found.top), realPathOf(cwd), repo)) return false
  const here = repoAt(cwd)
  return here !== null && repo.isProject(here) && marked(here.commonDir)
}

/**
 * Whether git, started in `dir`, finds the worktree whose top is `top`: dir
 * lies under top and no directory from dir up to top (top excluded) holds a
 * `.git`, which is where git's discovery would stop instead.
 */
function insideWorktree(top, dir, repo) {
  if (within(top, dir) === null) return false
  let current = repo.existingDirOf(dir)
  while (current !== top) {
    try {
      lstatSync(path.join(current, '.git'))
      return false
    } catch {
      // No .git here: git keeps climbing.
    }
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
  return true
}

/** The decision for one real target path. */
function judge(target, input, libs) {
  const { io, repo, loop, repoAt, budget } = libs
  const found = repoAt(repo.existingDirOf(target))
  if (found === null || !repo.isProject(found)) return io.pass()

  if (
    within(repo.realPathOf(found.gitDir), target) !== null ||
    within(repo.realPathOf(found.commonDir), target) !== null
  )
    return io.deny(gitDirReason)

  const relative = within(repo.realPathOf(found.top), target)
  // repoAt found this worktree from the target's own directory, so a target
  // outside it is not expected; it is refused rather than guessed.
  if (relative === null)
    return io.deny(`não consegui situar ${target} no worktree ${found.top}`)

  // Compared folded: macOS's default file system takes
  // `.Claude/Settings.local.json` for the real one. A linked worktree's `.git`
  // is a file pointing at its git dir, outside the git dir itself.
  const folded = fold(relative)
  if (folded === '.git' || folded.startsWith('.git/'))
    return io.deny(gitDirReason)
  if (folded === settingsLocal || folded.endsWith(`/${settingsLocal}`))
    return io.deny('a saída de emergência é do dono')

  if (found.branch === null)
    return io.deny('HEAD destacado: trabalhe numa branch da issue')
  // main before the intent: nothing is edited there, not even the intent.
  if (found.branch === repo.trunk)
    return io.deny(`em ${repo.trunk}, nada se edita: corte uma branch da issue`)

  // Compared as written, not folded: `Context/Intent/` is not the intent.
  if (relative.startsWith(intentDir)) return io.pass()

  const harness = repo.isHarnessPath(folded)
  const status = loop.gateStatus(repo.readGateCache(found.gitDir), {
    branch: found.branch,
    pendingPlan: hasPendingPlan(found, input, libs),
  })
  // An open gate lets an ordinary file through, ignored or not, so git is
  // asked about the ignore rules only when the answer changes the decision.
  if (status.state === 'open' && !harness) return io.pass()
  // A harness path is never let through for being ignored: .claude/ is where
  // Claude Code reads its own settings, local and ignored ones included, and
  // the rest of the harness asks even with the gate open. The spec names
  // only .claude/ here; the rest of the harness is the side that restricts.
  if (!harness && isIgnored(found.top, relative, budget)) return io.pass()

  switch (status.state) {
    case 'pending-plan':
      return io.ask(pendingPlanReason, { critical: true })
    case 'open':
      return harness
        ? io.ask(`caminho do harness (${relative}): confira`, {
            critical: true,
          })
        : io.pass()
    case 'unverified':
      // gateStatus reports unverified before it looks at `open`. A gate that
      // closed without reading the issue (gh absent, credential refused) is
      // still closed: the ask is only for a gate that opened without it.
      return status.cache?.open === true
        ? io.ask(
            'o gate abriu sem ler a issue (não verificado): confira antes de editar, ou rode npm run gate com acesso ao GitHub',
            { critical: true },
          )
        : io.deny(closedReason)
    case 'missing':
      return io.deny(`o gate ainda não rodou neste worktree: ${rerunGate}`)
    case 'stale':
      return io.deny(
        `o cache do gate venceu (vale ${loop.gateTtlHours} h): ${rerunGate}`,
      )
    case 'mismatch':
      return io.deny(
        `o cache do gate não é da branch ${found.branch}: ${rerunGate}`,
      )
    case 'closed':
      return io.deny(closedReason)
    default:
      // A state added to the contract and not handled here refuses.
      return io.deny(
        `estado do gate desconhecido (${status.state}): ${rerunGate}`,
      )
  }
}

function decide(input, { io, repo, loop, budget }) {
  const named = namedPaths(input)
  if (named.length === 0)
    return io.deny('a entrada do hook não traz o caminho do arquivo a editar')
  const cwd = typeof input.cwd === 'string' ? input.cwd : ''
  if (named.some((raw) => !path.isAbsolute(raw)) && !path.isAbsolute(cwd))
    return io.deny(
      'o caminho do arquivo é relativo e a entrada não traz o cwd para resolvê-lo',
    )

  budget.startBudget('build-guard')
  // One repoAt per directory: the places of one call mostly share it, and
  // each costs up to four git runs.
  const known = new Map()
  const repoAt = (dir) => {
    const start = repo.existingDirOf(dir)
    if (!known.has(start)) {
      budget.checkBudget(`ler o repositório de ${start}`)
      known.set(start, repo.repoAt(start))
    }
    return known.get(start)
  }
  const libs = { io, repo, loop, repoAt, realPathOf: repo.realPathOf, budget }
  // A budget spent halfway keeps what the places judged so far decided: a
  // deny among them still wins over the budget's ask.
  const decisions = []
  try {
    for (const place of targetsOf(named, cwd, repo.realPathOf))
      decisions.push(
        place.refusal === undefined
          ? judge(place.target, input, libs)
          : io.deny(place.refusal),
      )
  } catch (error) {
    if (!(error instanceof budget.BudgetExhausted)) throw error
    decisions.push(io.ask(error.message, { critical: true }))
  }
  return io.combine(decisions)
}

let io = null
try {
  io = await import('./lib/io.mjs')
  const [repo, loop, budget] = await Promise.all([
    import('./lib/repo.mjs'),
    import('../../scripts/loop-sections.mjs'),
    import('./lib/budget.mjs'),
  ])
  const input = await io.readInput()
  const decision =
    input === null
      ? io.deny('a entrada do hook não pôde ser lida')
      : io.resolve(
          decide(input, { io, repo, loop, budget }),
          input.permission_mode,
        )
  process.stdout.write(io.preToolUseOutput(decision))
} catch (error) {
  const reason = `o hook falhou: ${error instanceof Error ? error.message : String(error)}`
  if (io === null) {
    process.stderr.write(`hooks do loop: ${reason}\n`)
    process.exitCode = 2
  } else process.stdout.write(io.preToolUseOutput(io.deny(reason)))
}
