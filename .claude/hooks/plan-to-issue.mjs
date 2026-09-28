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
//
// The same fallback takes any failure of an accepted plan's marking, not
// only a library that did not load (Copilot review of #26, fifth round): a
// budget spent while the repository was read, a git dir it cannot write, a
// bug. It fails closed. It writes the marker by its own short path (git
// rev-parse --git-common-dir and one file), in a slice of the budget the
// library holds back for it; when even that write fails, it removes the
// gate's cache from every worktree of the repository, so build-guard reads
// the gate as never run instead of open on an Approve that predates the
// plan; and it tells Claude, through exit 2, exactly which of these it
// did, or, when it could do neither, that nothing was written and nothing
// may be built. The input is read here, before the libraries load, so the
// fallback has it whatever failed. On a publication, a failure never
// removes the marker: the fallback touches nothing there and says so.
//
// The fallback writes only in this project (Copilot review of #54): before
// the marker, it reads the origin from the repository's config file, and in
// a repository whose origin is another one, or that has none, it touches
// nothing, as the library would not. An origin it cannot read keeps it
// failing closed.
import { spawnSync } from 'node:child_process'
import {
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

/**
 * The marker's file name, as loop-sections' planPendingFile gives it, for
 * when that module is what failed to load: planPendingPrefix, the session
 * id with [A-Za-z0-9-] kept and every other UTF-8 byte as `_XX` (a lone
 * surrogate as `_uXXXX`), `_` for none, and `.json`.
 * test/hooks/plan-to-issue.spec.ts holds the two equal.
 */
function fallbackMarkerName(sessionId) {
  const id = String(sessionId ?? '')
  if (id === '') return 'loop-plan-pending-_.json'
  const hex = (value, width) =>
    value.toString(16).toUpperCase().padStart(width, '0')
  let encoded = ''
  for (const char of id) {
    const code = char.codePointAt(0)
    if (/^[A-Za-z0-9-]$/.test(char)) encoded += char
    else if (code >= 0xd800 && code <= 0xdfff) encoded += `_u${hex(code, 4)}`
    else
      for (const byte of new TextEncoder().encode(char))
        encoded += `_${hex(byte, 2)}`
  }
  return `loop-plan-pending-${encoded}.json`
}

/**
 * loop-sections' gateCacheFile, for when that module failed to load;
 * test/hooks/plan-to-issue.spec.ts holds the two equal.
 */
const gateCacheName = 'loop-gate.json'

/**
 * lib/repo.mjs' projectRepo, for when that module failed to load;
 * test/hooks/plan-to-issue.spec.ts holds the two equal, by the fallback
 * marking a plan in this project's repository and in no other.
 */
const projectName = 'geazioliveira/marketo-sandbox'

/**
 * The repository the origin names in the config file of the common git dir,
 * read with nothing but Node's own, the way lib/repo.mjs' repoFromRemote
 * reads a URL: `{ known: true, repo }`, with `repo` the lowercased
 * `owner/name` on github.com, or null when there is no origin or it is on
 * another host; `{ known: false }` when the file cannot be read or the
 * origin has more than one URL. Includes and `insteadOf` are not followed:
 * this only tells a repository that is plainly another one.
 */
function fallbackOrigin(commonDir) {
  let text
  try {
    text = readFileSync(path.join(commonDir, 'config'), 'utf8')
  } catch {
    return { known: false }
  }
  const urls = new Set()
  let inOrigin = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const header =
      /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line)
    if (header !== null) {
      const section = header[1].toLowerCase()
      inOrigin =
        (section === 'remote' && header[2] === 'origin') ||
        (header[2] === undefined && section === 'remote.origin')
      continue
    }
    if (!inOrigin) continue
    const entry = /^url\s*=\s*(.*)$/i.exec(line)
    if (entry !== null) urls.add(entry[1].trim().replace(/^"(.*)"$/, '$1'))
  }
  if (urls.size > 1) return { known: false }
  if (urls.size === 0) return { known: true, repo: null }
  const matched =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(
      [...urls][0],
    )
  return {
    known: true,
    repo: matched ? `${matched[1]}/${matched[2]}`.toLowerCase() : null,
  }
}

/** The fallback's git bound when no budget holds one (the libraries did not load). */
const fallbackGitMs = 10_000

/**
 * The least the fallback's git gets, even when the budget is spent: it fits
 * in the margin between the budget and the hook's timeout in settings.json.
 */
const leastGitMs = 1_000

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
 * marker there, or the reason it could not be found (`notRepo` when git
 * says the directory is in no repository). git runs through argv, bounded,
 * with no variable a git hook may have left pointing it elsewhere.
 */
function commonGitDir(cwd, timeout) {
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
      timeout,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (run.error?.code === 'ETIMEDOUT' || run.signal != null)
    return { reason: `o git não respondeu em ${timeout} ms` }
  if (run.error !== undefined || run.status !== 0) {
    const reason =
      String(run.error?.message ?? run.stderr ?? '').trim() || 'git falhou'
    return { reason, notRepo: /not a git repository/i.test(reason) }
  }
  const dir = String(run.stdout).trim()
  return dir === '' ? { reason: 'o git não deu o diretório' } : { dir }
}

/** Writes the marker whole or not at all; the reason it failed, or null. */
function writeMarker(target, data) {
  const scratch = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(scratch, `${JSON.stringify(data, null, 2)}\n`)
    renameSync(scratch, target)
    return null
  } catch (failure) {
    rmSync(scratch, { force: true })
    return failure?.message ?? String(failure)
  }
}

/**
 * Removes the gate's cache from every worktree's git dir: the common dir
 * (the main worktree's) and each linked worktree's under `worktrees/`, as
 * repo.mjs' worktreeGitDirs lists them. Every removal is tried, and each
 * one that fails is named.
 * @returns {{ removed: string[], failed: { file: string, reason: string }[] }}
 */
function clearCaches(commonDir) {
  const removed = []
  const failed = []
  const dirs = [commonDir]
  const admin = path.join(commonDir, 'worktrees')
  try {
    for (const entry of readdirSync(admin, { withFileTypes: true }))
      if (entry.isDirectory()) dirs.push(path.join(admin, entry.name))
  } catch (error) {
    // No linked worktree yet; any other failure is not read as none.
    if (error?.code !== 'ENOENT')
      failed.push({ file: admin, reason: error?.message ?? String(error) })
  }
  for (const dir of dirs) {
    const file = path.join(dir, gateCacheName)
    try {
      rmSync(file)
      removed.push(file)
    } catch (error) {
      if (error?.code !== 'ENOENT')
        failed.push({ file, reason: error?.message ?? String(error) })
    }
  }
  return { removed, failed }
}

const publishPlan =
  'publique o plano numa issue, num comentário cuja primeira linha é exatamente # Plano, e espere o Approve do dono antes de editar fora de context/intent/'

/**
 * What the hook does when the libraries did not load (`stage` 'load') or
 * failed (`stage` 'run'), and returns what stderr tells Claude. On
 * ExitPlanMode it fails closed: the marker by the short path, else the gate
 * caches of every worktree, and it says which. On anything else it touches
 * nothing: a failure never removes a marker.
 */
function failClosed(input, { stage, why, gitMs }) {
  const head =
    stage === 'load'
      ? `hooks do loop: o plan-to-issue não carregou suas bibliotecas (${why})`
      : `hooks do loop: o plan-to-issue falhou (${why})`
  if (input?.tool_name !== 'ExitPlanMode')
    return stage === 'load'
      ? `${head}. O marcador de um plano aceito e ainda não publicado, se havia um, continua como estava: nenhuma publicação o remove até o hook voltar a carregar. Avise o dono.\n`
      : `${head}. A falha não remove o marcador de um plano aceito e ainda não publicado: se havia um, ele continua como estava. Avise o dono.\n`
  const cwd = path.resolve(
    typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '.',
  )
  const sessionId =
    typeof input.session_id === 'string' ? input.session_id : null
  const found = commonGitDir(cwd, gitMs)
  if (found.dir === undefined)
    return found.notRepo
      ? `${head}. ${cwd} não fica num repositório git: não há marcador de plano a gravar nem cache do gate a remover. Avise o dono.\n`
      : `${head}. Nada foi gravado: não achei o diretório do git de ${cwd} (${found.reason}), então nem o marcador do plano aceito foi gravado nem o cache do gate foi removido, e o gate pode continuar aberto para um plano que o dono não viu. Não construa: ${publishPlan}. Avise o dono.\n`
  const origin = fallbackOrigin(found.dir)
  if (origin.known && origin.repo !== projectName)
    return `${head}. ${cwd} não fica neste projeto (${
      origin.repo === null
        ? 'o repositório não tem um origin no github.com'
        : `o origin é ${origin.repo}`
    }): o hook não grava o marcador do plano nem remove o cache do gate de outro repositório. Avise o dono.\n`
  const plan =
    typeof input.tool_input?.plan === 'string'
      ? input.tool_input.plan
      : typeof input.tool_response?.plan === 'string'
        ? input.tool_response.plan
        : ''
  const target = path.join(found.dir, fallbackMarkerName(sessionId))
  const failure = writeMarker(target, {
    schema: 1,
    sessionId,
    branch: null,
    acceptedAt: new Date().toISOString(),
    planFilePath:
      typeof input.tool_input?.planFilePath === 'string'
        ? input.tool_input.planFilePath
        : null,
    planHead: Array.from(plan).slice(0, 300).join(''),
    failure: { stage, reason: why },
  })
  if (failure === null)
    return `${head}. O plano aceito foi marcado como pendente mesmo assim, pelo caminho de reserva (${target}): um plano aceito no plan mode não é Approve; publique-o numa issue antes de construir, num comentário cuja primeira linha é exatamente # Plano. ${
      stage === 'load'
        ? 'Até o hook voltar a carregar, nenhuma publicação remove o marcador.'
        : 'Publicado o plano, o hook remove o marcador como sempre.'
    } Avise o dono.\n`

  // No marker: the caches go, so no worktree reads the gate as open on an
  // Approve older than this plan. On a run that threw, the library wrote
  // no marker, whether its write failed or it never reached one.
  const lost =
    stage === 'run'
      ? `o marcador do plano aceito não pôde ser gravado nem pelo caminho de reserva, em ${target} (${failure})`
      : `o marcador do plano aceito não pôde ser gravado em ${target} (${failure})`
  const caches = clearCaches(found.dir)
  const removed = caches.removed.map((file) => path.dirname(file)).join(', ')
  if (caches.failed.length === 0)
    return `${head}, e ${lost}. Em troca, ${
      caches.removed.length > 0
        ? `removi o cache do gate de ${caches.removed.length} worktree(s) deste repositório (${removed})`
        : 'nenhuma worktree deste repositório tinha cache do gate a remover'
    }: o build-guard lê o gate como não rodado e nega a edição. Não rode npm run gate nem construa antes de publicar o plano numa issue, num comentário cuja primeira linha é exatamente # Plano: sem o marcador, o gate não sabe deste plano e reabriria sobre o Approve antigo. Avise o dono.\n`
  const failed = caches.failed
    .map(({ file, reason }) => `${file} (${reason})`)
    .join('; ')
  if (caches.removed.length === 0)
    return `${head}. Nada foi gravado: ${lost}, e não consegui remover o cache do gate: ${failed}. O gate pode continuar aberto para um plano que o dono não viu. Não construa: ${publishPlan}. Avise o dono.\n`
  return `${head}, e ${lost}. Removi o cache do gate de ${removed}, mas não consegui remover ${failed}: onde ele ficou, o gate pode continuar aberto para um plano que o dono não viu. Não construa: ${publishPlan}. Avise o dono.\n`
}

const reasonOf = (error) =>
  error instanceof Error ? error.message : String(error)

const input = await readRawInput()
let publication = null
let loadError = null
try {
  publication = await import('./lib/plan-publication.mjs')
} catch (error) {
  loadError = error
}

if (publication === null) {
  process.stderr.write(
    failClosed(input, {
      stage: 'load',
      why: reasonOf(loadError),
      gitMs: fallbackGitMs,
    }),
  )
  process.exitCode = 2
} else {
  try {
    const out = await publication.run(input)
    if (out !== null) process.stdout.write(`${out}\n`)
    process.exitCode = 0
  } catch (error) {
    // The slice of the budget the library held back for this, with what is
    // left of the rest; none started, the fallback's own bound.
    let window = null
    try {
      window = publication.fallbackWindowMs?.() ?? null
    } catch {
      window = null
    }
    const gitMs =
      window === null
        ? fallbackGitMs
        : Math.max(leastGitMs, Math.min(fallbackGitMs, window))
    process.stderr.write(
      failClosed(input, { stage: 'run', why: reasonOf(error), gitMs }),
    )
    process.exitCode = 2
  }
}
