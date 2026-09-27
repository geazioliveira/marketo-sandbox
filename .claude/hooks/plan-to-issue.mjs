// PostToolUse ExitPlanMode|Bash|Monitor|mcp__terminal__run_in_terminal (#5):
// a plan accepted in plan mode is pending until it is posted on an issue.
//
// Accepting a plan in Claude Code's plan mode feels like an approval, and
// that is the trap: the Approve is the owner's comment on the issue, and a
// plan nobody posted cannot be approved there. So when ExitPlanMode returns,
// this hook writes a marker for the session into the repository's common git dir, and
// gateStatus reads the gate as closed ('pending-plan') while it exists,
// however recently the gate ran. The build guard then asks before any edit
// outside context/intent/.
//
// Only a publication removes the marker: a `gh issue comment` whose body
// opens with `# Plano`, on the issue the branch names when it names one, or
// a `gh issue create` whose body carries every required section, for this
// project, whose output shows the issue's URL.
// The URL is gh's own word that the post went through; a command that
// printed none may have failed, so the marker stays and the hook says so.
// It is gh's word only when gh is all the line ran: the gh of PATH, alone
// but for a `cd`. Anything else on the line could have printed the URL, or
// rewritten the body file after gh read it.
//
// Each publication is judged where its gh runs: the directory its `cd`
// leads to, and the worktree there, whose branch names the issue and whose
// repository holds the marker and the caches.
//
// guard-bash lets a gh run through Monitor and the terminal panel's
// mcp__terminal__run_in_terminal too, and neither need return gh's output:
// Monitor starts the command in the background, and the terminal runs it
// where the hook cannot read. There, with no URL of gh's in the response,
// the hook asks GitHub itself (Copilot review of #26): the issue must hold a
// comment of the account's, created after the plan was accepted, that opens
// exactly with `# Plano` (for `gh issue create`, a new issue of the
// account's in this project, with the plan's sections). No evidence, no
// removal: the marker stays and the hook says why.
//
// The publication also removes the gate's cache in every worktree of the
// repository: a cache was written before this plan, and the Approve it read
// is not an Approve of the plan just posted. The marker lives in the common
// git dir, where every worktree sees it, so removing it opens them all.
//
// A PostToolUse hook cannot undo the tool call, so it never blocks: it
// writes or removes the marker and tells the agent what it did, in the
// additionalContext Claude reads next to the tool result.
//
// The libraries load inside a try, not at the top (Copilot review of #26,
// fourth round): a module that failed to load would end the process with
// exit 1, a non-blocking error Claude Code only shows the person, and an
// accepted plan would go unmarked, which build-guard reads as no plan. So
// the work lives in lib/plan-publication.mjs, imported here in a try. When
// it cannot load, this file, which imports nothing of the loop's, still
// marks a plan accepted by ExitPlanMode as pending, with the marker named
// as loop-sections names it; it never removes one; and it says so on
// stderr with exit 2, which for PostToolUse Claude Code shows to Claude
// (the hooks reference: "Shows stderr to Claude; the tool already ran").
import { spawnSync } from 'node:child_process'
import { renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The marker's file name, as loop-sections' planPendingFile gives it, for
 * when that module is what failed to load: planPendingPrefix, the session
 * id with every character outside [A-Za-z0-9_-] made `_`, `_` for none, and
 * `.json`. test/hooks/plan-to-issue.spec.ts holds the two equal.
 */
function fallbackMarkerName(sessionId) {
  const id = String(sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '_')
  return `loop-plan-pending-${id === '' ? '_' : id}.json`
}

/** Reads stdin whole as a JSON object, or null, with nothing but Node's own. */
async function readRawInput() {
  const chunks = []
  try {
    for await (const chunk of process.stdin)
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

/**
 * The common git dir around the input's cwd, as plan-to-issue writes the
 * marker there, or the reason it could not be found. git runs through argv,
 * bounded, with no variable a git hook may have left pointing it elsewhere.
 */
function commonGitDir(cwd) {
  const env = {}
  for (const [name, value] of Object.entries(process.env))
    if (
      !/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CEILING_DIRECTORIES)$/.test(
        name,
      )
    )
      env[name] = value
  const run = spawnSync(
    'git',
    ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      encoding: 'utf8',
      env: { ...env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (run.error !== undefined || run.status !== 0)
    return {
      reason:
        String(run.error?.message ?? run.stderr ?? '').trim() || 'git falhou',
    }
  return { dir: String(run.stdout).trim() }
}

/**
 * What the hook does when its libraries do not load: on ExitPlanMode,
 * writes the marker all the same (whole or not at all), with what can be
 * read without them; on anything else, touches nothing. Returns what stderr
 * tells Claude.
 */
async function onLoadFailure(error) {
  const why = error instanceof Error ? error.message : String(error)
  const head = `hooks do loop: o plan-to-issue não carregou suas bibliotecas (${why})`
  const input = await readRawInput()
  if (input?.tool_name !== 'ExitPlanMode')
    return `${head}. O marcador de um plano aceito e ainda não publicado, se havia um, continua como estava: nenhuma publicação o remove até o hook voltar a carregar. Avise o dono.\n`
  const cwd = path.resolve(
    typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '.',
  )
  const sessionId =
    typeof input.session_id === 'string' ? input.session_id : null
  const found = commonGitDir(cwd)
  if (found.dir === undefined)
    return `${head}, e o marcador do plano aceito não pôde ser gravado (${found.reason}): publique o plano numa issue antes de construir, e não edite fora de context/intent/ até lá. Avise o dono.\n`
  const plan =
    typeof input.tool_input?.plan === 'string'
      ? input.tool_input.plan
      : typeof input.tool_response?.plan === 'string'
        ? input.tool_response.plan
        : ''
  const target = path.join(found.dir, fallbackMarkerName(sessionId))
  try {
    const scratch = `${target}.${process.pid}.tmp`
    writeFileSync(
      scratch,
      `${JSON.stringify(
        {
          schema: 1,
          sessionId,
          branch: null,
          acceptedAt: new Date().toISOString(),
          planFilePath:
            typeof input.tool_input?.planFilePath === 'string'
              ? input.tool_input.planFilePath
              : null,
          planHead: Array.from(plan).slice(0, 300).join(''),
          loadFailure: why,
        },
        null,
        2,
      )}\n`,
    )
    renameSync(scratch, target)
  } catch (failure) {
    return `${head}, e o marcador do plano aceito não pôde ser gravado em ${target} (${failure?.message ?? failure}): publique o plano numa issue antes de construir, e não edite fora de context/intent/ até lá. Avise o dono.\n`
  }
  return `${head}. O plano aceito foi marcado como pendente mesmo assim (${target}): um plano aceito no plan mode não é Approve; publique-o numa issue antes de construir, num comentário cuja primeira linha é exatamente # Plano. Até o hook voltar a carregar, nenhuma publicação remove o marcador. Avise o dono.\n`
}

let publication = null
let loadError = null
try {
  publication = await import('./lib/plan-publication.mjs')
} catch (error) {
  loadError = error
}

if (publication === null) {
  process.stderr.write(await onLoadFailure(loadError))
  process.exitCode = 2
} else {
  try {
    const out = await publication.run()
    if (out !== null) process.stdout.write(`${out}\n`)
  } catch {
    // main never throws past its own catch; anything else here is a bug in
    // the hook, and a PostToolUse hook's failure must not surface as an
    // error on a tool call that already ran.
  }
  process.exitCode = 0
}
