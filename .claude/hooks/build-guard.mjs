// The build guard (#5): a PreToolUse hook on Edit, Write and NotebookEdit.
//
// Building starts only once the gate is open for the branch: the owner's
// Approve read, the issue in ready-for-agent, the branch cut for it. The gate
// leaves that verdict in loop-gate.json, under the worktree's git dir, and
// this hook reads it before every file the agent writes in this project.
// context/intent/ is the exception, since the intent is written before the
// gate can open; so are files the repository's own .gitignore files ignore,
// which never reach a commit, outside the harness, unless a plan accepted in
// this session is still unpublished: then only the intent goes through
// without a person looking. main is never edited, and
// neither is the git dir or the owner's emergency exit. A path is judged
// where the write lands, through every symlink, dangling ones included
// (lib/repo.mjs's placeOf, which guard-bash reads shell writes with too).
//
// The repository is the one around the file, never ${CLAUDE_PROJECT_DIR}: a
// session opened in the main checkout edits files in worktrees, and each
// worktree has its own branch and its own gate cache.
//
// What the gate says once the file is placed is lib/edit-gate.mjs's, which
// git-rules also asks for the files a git command writes (`git checkout --
// file`, `git merge`): an edit and a git write get one decision.
//
// The libraries are imported inside the try, not at the top: a module that
// fails to load would end the process with exit 1, which Claude Code reads
// as a non-blocking error and lets the edit through. When io.mjs itself
// cannot load, there is no JSON to print, so the hook exits 2, which blocks.
import { homedir } from 'node:os'
import path from 'node:path'

// Claude Code kills a hook past its timeout (90 s in settings.json), and a
// killed hook is a non-blocking error: the edit goes through. Each git call
// is bounded on its own, but a run makes several, so the run as a whole has
// a budget too (budget.mjs), shared by every git it starts, repoAt's
// included: each one's timeout is what is left of it at most. Past it, the
// hook asks, critical, instead of racing the kill (Copilot review of #26).

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
function targetsOf(named, cwd, repo) {
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
        const target = repo.placeOf(spelling, { followLast })
        targets.set(`path:${target}`, { target })
      } catch (error) {
        if (!(error instanceof repo.Unplaceable)) throw error
        targets.set(`error:${error.message}`, { refusal: error.message })
      }
    }
  return [...targets.values()]
}

/** The decision for one real target path. */
function judge(target, input, libs) {
  const { io, repo, gate, repoAt } = libs
  const found = repoAt(repo.existingDirOf(target))
  if (found === null || !repo.isProject(found)) return io.pass()

  if (
    gate.within(repo.realPathOf(found.gitDir), target) !== null ||
    gate.within(repo.realPathOf(found.commonDir), target) !== null
  )
    return io.deny(gate.gitDirReason)

  const relative = gate.within(repo.realPathOf(found.top), target)
  // repoAt found this worktree from the target's own directory, so a target
  // outside it is not expected; it is refused rather than guessed.
  if (relative === null)
    return io.deny(`não consegui situar ${target} no worktree ${found.top}`)

  return gate.editDecision(found, relative, input, { repoAt })
}

function decide(input, { io, repo, gate, budget }) {
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
  const libs = { io, repo, gate, repoAt }
  // A budget spent halfway keeps what the places judged so far decided: a
  // deny among them still wins over the budget's ask.
  const decisions = []
  try {
    for (const place of targetsOf(named, cwd, repo))
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
  const [repo, gate, budget] = await Promise.all([
    import('./lib/repo.mjs'),
    import('./lib/edit-gate.mjs'),
    import('./lib/budget.mjs'),
  ])
  const input = await io.readInput()
  const decision =
    input === null
      ? io.deny('a entrada do hook não pôde ser lida')
      : io.resolve(
          decide(input, { io, repo, gate, budget }),
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
