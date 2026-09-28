// The gate a write to the worktree goes through (#5): one decision, shared by
// build-guard, which judges the file an Edit, Write or NotebookEdit names,
// and git-rules, which judges the files a git command writes (`git checkout
// -- file`, `git restore`, `git merge`…). Both ask the same question of the
// same place, so the answer lives here once and cannot drift apart (Copilot
// review of #26, fourth round).
//
// Building starts only once the gate is open for the branch: the owner's
// Approve read, the issue in ready-for-agent, the branch cut for it. The gate
// leaves that verdict in loop-gate.json, under the worktree's git dir.
// context/intent/ is the exception, since the intent is written before the
// gate can open; so are files the repository's own .gitignore files ignore,
// which never reach a commit, outside the harness, unless a plan accepted in
// this session is still unpublished: then only the intent goes through
// without a person looking. main is never written, and neither is the git
// dir or the owner's emergency exit.
import { spawnSync } from 'node:child_process'
import { lstatSync } from 'node:fs'
import path from 'node:path'
import { gateStatus, gateTtlHours } from '../../../scripts/loop-sections.mjs'
import { afterSpawn, spawnTimeout } from './budget.mjs'
import { ask, deny, pass } from './io.mjs'
import {
  existingDirOf,
  isHarnessPath,
  isProject,
  pendingPlanExists,
  readGateCache,
  realPathOf,
  trunk,
} from './repo.mjs'

export const gitDirReason = 'o diretório do git não se edita à mão'
const pendingPlanReason =
  'há um plano aceito nesta sessão e ainda não publicado numa issue: publique-o antes de construir'
const rerunGate = 'rode npm run gate na branch antes de editar'
const closedReason =
  'o gate está fechado: rode npm run gate e resolva o que ele aponta'

/** The owner's emergency exit (disableAllHooks lives there), at any depth. */
export const settingsLocal = '.claude/settings.local.json'

/** Where the intent is written, before the gate can open. */
export const intentDir = 'context/intent/'

// repo.mjs keeps its git runner to itself, so the one git call made here
// repeats its hygiene: no variable a git hook leaves in Claude Code's
// environment may point git at another repository, the messages are in
// English, and reading takes no optional lock.
const discoveryVariable =
  /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|NAMESPACE|PREFIX)$/
const gitTimeoutMs = 10_000

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
export function fold(text) {
  return text.normalize('NFKC').toUpperCase().toLowerCase()
}

/**
 * A path relative to a directory, with `/` separators, or null when it lies
 * outside. '' is the directory itself. Both sides are real paths already.
 */
export function within(dir, target) {
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
function isIgnored(top, relative) {
  if (relative === '') return false
  const step = 'conferir o .gitignore'
  const timeout = spawnTimeout(gitTimeoutMs, step)
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
  afterSpawn(run, gitTimeoutMs, timeout, step)
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
 * Whether git, started in `dir`, finds the worktree whose top is `top`: dir
 * lies under top and no directory from dir up to top (top excluded) holds a
 * `.git`, which is where git's discovery would stop instead.
 */
function insideWorktree(top, dir) {
  if (within(top, dir) === null) return false
  let current = existingDirOf(dir)
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

/**
 * Whether this session has a plan it accepted and has not published.
 * plan-to-issue writes the marker into the common git dir of the session's
 * repository, one place per repository whatever worktree the session is in,
 * named for the session. So the worktree's common git dir counts, and so does
 * the common git dir of a session cwd in another clone of this project.
 * null when it cannot be told: an input with no absolute cwd names no
 * session repository to look in (Copilot review of #26, third round).
 * @returns {boolean | null}
 */
function hasPendingPlan(found, input, repoAt) {
  const marked = (dir) => pendingPlanExists(dir, input.session_id)
  if (marked(found.commonDir)) return true

  // The session's own repository. git runs only when the cwd may lie in
  // another one: a cwd inside the worktree with no `.git` between them is
  // that worktree, whose common git dir was just read.
  const cwd = typeof input.cwd === 'string' ? input.cwd : ''
  if (!path.isAbsolute(cwd)) return null
  if (insideWorktree(realPathOf(found.top), realPathOf(cwd))) return false
  const here = repoAt(cwd)
  return here != null && isProject(here) && marked(here.commonDir)
}

/**
 * The decision for writing `relative` in the worktree `found`, as the gate
 * sees it: `found` is repoAt's answer for this project's worktree, and
 * `relative` a path under its top, with `/` separators, '' for the worktree
 * as a whole (a write whose files are not named, such as `git merge`). The
 * hook's input gives the session (session_id, cwd) whose plan marker counts;
 * `repoAt` is the caller's, so its answers and its budget are shared.
 *
 * The caller has placed the path already: it lies in this worktree and not
 * in its git dir. What is left is the same for any writer.
 */
export function editDecision(found, relative, input, { repoAt }) {
  // Compared folded: macOS's default file system takes
  // `.Claude/Settings.local.json` for the real one. A linked worktree's `.git`
  // is a file pointing at its git dir, outside the git dir itself.
  const folded = fold(relative)
  if (folded === '.git' || folded.startsWith('.git/')) return deny(gitDirReason)
  if (folded === settingsLocal || folded.endsWith(`/${settingsLocal}`))
    return deny('a saída de emergência é do dono')

  if (found.branch === null)
    return deny('HEAD destacado: trabalhe numa branch da issue')
  // main before the intent: nothing is edited there, not even the intent.
  if (found.branch === trunk)
    return deny(`em ${trunk}, nada se edita: corte uma branch da issue`)

  // Compared as written, not folded: `Context/Intent/` is not the intent.
  if (relative.startsWith(intentDir)) return pass()

  const harness = isHarnessPath(folded)
  const pending = hasPendingPlan(found, input ?? {}, repoAt)
  const status = gateStatus(readGateCache(found.gitDir), {
    branch: found.branch,
    pendingPlan: pending !== false,
  })
  // A plan accepted and not yet posted asks before any shortcut: an ignored
  // file (a build output, a generated file) is still building before the
  // plan is on an issue (Copilot review of #26, third round). Only the
  // intent, written before the plan, and the refusals above come first. A
  // marker it cannot look for counts as one.
  if (status.state === 'pending-plan')
    return ask(
      pending === null
        ? 'não consegui saber se esta sessão tem um plano aceito e ainda não publicado: a entrada não traz o cwd da sessão'
        : pendingPlanReason,
      { critical: true },
    )
  // An open gate lets an ordinary file through, ignored or not, so git is
  // asked about the ignore rules only when the answer changes the decision.
  if (status.state === 'open' && !harness) return pass()
  // A harness path is never let through for being ignored: .claude/ is where
  // Claude Code reads its own settings, local and ignored ones included, and
  // the rest of the harness asks even with the gate open. The spec names
  // only .claude/ here; the rest of the harness is the side that restricts.
  if (!harness && isIgnored(found.top, relative)) return pass()

  switch (status.state) {
    case 'open':
      return harness
        ? ask(`caminho do harness (${relative}): confira`, { critical: true })
        : pass()
    case 'unverified':
      // gateStatus reports unverified before it looks at `open`. A gate that
      // closed without reading the issue (gh absent, credential refused) is
      // still closed: the ask is only for a gate that opened without it.
      return status.cache?.open === true
        ? ask(
            'o gate abriu sem ler a issue (não verificado): confira antes de editar, ou rode npm run gate com acesso ao GitHub',
            { critical: true },
          )
        : deny(closedReason)
    case 'missing':
      return deny(`o gate ainda não rodou neste worktree: ${rerunGate}`)
    case 'stale':
      return deny(
        `o cache do gate venceu (vale ${gateTtlHours} h): ${rerunGate}`,
      )
    case 'mismatch':
      return deny(
        `o cache do gate não é da branch ${found.branch}: ${rerunGate}`,
      )
    case 'closed':
      return deny(closedReason)
    default:
      // A state added to the contract and not handled here refuses.
      return deny(`estado do gate desconhecido (${status.state}): ${rerunGate}`)
  }
}
