// PostToolUse ExitPlanMode|Bash (#5): a plan accepted in plan mode is
// pending until it is posted on an issue.
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
// The publication also removes the gate's cache in the worktree: the cache
// was written before this plan, and the Approve it read is not an Approve of
// the plan just posted.
//
// A PostToolUse hook cannot undo the tool call, so it never blocks: it
// writes or removes the marker and tells the agent what it did.
import { rmSync } from 'node:fs'
import path from 'node:path'
import {
  agentPlanLabelTransition,
  bugSections,
  categoryLabels,
  checkSections,
  commentOpening,
  featureSections,
  gateCacheFile,
  issueFromBranch,
  kindOf,
  sectionsFor,
} from '../../scripts/loop-sections.mjs'
import { autonomousModes, contextOutput, readInput } from './lib/io.mjs'
import {
  clearPendingPlan,
  isProject,
  pendingPlanExists,
  projectRepo,
  repoAt,
  writePendingPlan,
} from './lib/repo.mjs'
import { optionValues, parseCommand, readBody } from './lib/shell.mjs'

const event = 'PostToolUse'

/** How much of the plan the marker keeps: enough to tell two plans apart. */
const planHeadLength = 300

/** The category label whose plans carry bugSections, and the other one. */
const bugKind = categoryLabels.find(
  (label) => sectionsFor(label) === bugSections,
)
const featureKind = categoryLabels.find(
  (label) => sectionsFor(label) === featureSections,
)

const headings = (sections) =>
  sections.map((section) => section.heading).join(', ')

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * An issue URL of this project as gh prints it after posting, a whole line
 * of stdout: the issue itself after `gh issue create`, the comment
 * (`…/issues/5#issuecomment-…`) after `gh issue comment`. A URL inside other
 * text, or with more after the number (`/5abc`, `/5/comments`), is not what
 * gh printed. A pull request's URL is no issue's: a plan posted on a PR is
 * not where the gate reads it.
 */
const projectIssueUrl = new RegExp(
  `^[ \\t]*https://github\\.com/${escapeRegExp(projectRepo)}/issues/([1-9]\\d*)(?:#issuecomment-\\d+)?[ \\t]*\\r?$`,
  'gim',
)

/** Commands that only move the shell: the one company a publication may keep on its line. */
const shellMoves = new Set(['cd', 'pushd', 'popd'])

/** An issue named by URL, as `gh issue comment` takes one: its repository and number. */
const issueUrlArg =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/([1-9]\d*)(?:[/?#]\S*)?$/i

/** Flags of `gh issue comment` and `gh issue create` that take a value. */
const valueFlags = new Set([
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-R',
  '--repo',
  '-t',
  '--title',
  '-l',
  '--label',
  '-a',
  '--assignee',
  '-m',
  '--milestone',
  '-p',
  '--project',
  '-T',
  '--template',
  '--recover',
])

/** The words after `from` that are no flag nor a flag's value, with their argv index. */
function positionals(argv, from) {
  const found = []
  for (let k = from; k < argv.length; k += 1) {
    const arg = argv[k]
    if (arg === '--') {
      for (let rest = k + 1; rest < argv.length; rest += 1)
        found.push({ value: argv[rest], index: rest })
      break
    }
    if (arg.startsWith('-') && arg !== '-') {
      if (valueFlags.has(arg)) k += 1
      continue
    }
    found.push({ value: arg, index: k })
  }
  return found
}

const isKnown = (command, index) =>
  command.known?.[index] !== false && !/[$`]/.test(command.argv[index] ?? '')

/**
 * Whether the command runs the gh of PATH: its own text, up to `issue`,
 * ends in the bare word `gh`. parseCommand reduces `./gh` and `/x/gh` to
 * `gh`, which is right for the guard, where any gh is judged; here the
 * restrictive side is the other one, since a script of that name prints
 * whatever URL it likes. A quoted or escaped `gh` does not count either:
 * the spec is silent, and a plain `gh` costs nothing.
 */
function ghOfPath(command) {
  const head = /^([\s\S]*?)\s+issue\s/.exec(
    String(command.text ?? '').replace(/\\\r?\n/g, ' '),
  )
  return head !== null && head[1].trim().split(/\s+/).at(-1) === 'gh'
}

/** `gh issue comment …` or `gh issue create …` (and its alias `new`), or null. */
function publicationKind(command) {
  const [program, group, verb] = command.argv
  if (typeof program !== 'string' || path.basename(program) !== 'gh')
    return null
  if (group !== 'issue') return null
  if (verb === 'comment') return 'comment'
  if (verb === 'create' || verb === 'new') return 'create'
  return null
}

/** The command as a person reads it in a message, cut short. */
function shortText(command) {
  const text = command.argv.slice(0, 4).join(' ')
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

/**
 * Whether the command posts to this project, and on which issue when it
 * names one. The target is the one gh would use: an issue URL given as the
 * argument, else `-R/--repo`, else GH_REPO, else the repository of the
 * directory the command runs in. A target that cannot be read (an
 * expansion) is `unknown` and counts as another repository: the marker
 * stays, the restrictive side, and the hook says why.
 * @returns {{ project: boolean, issue: number | null, unknown: boolean }}
 */
function targetOf(command, kind, baseCwd, inputRepo) {
  const unknown = { project: false, issue: null, unknown: true }
  const hasExpansion = (text) => /[$`]/.test(text)
  let issue = null
  if (kind === 'comment') {
    // gh takes the issue as a number, `#N` or its URL. Anything else, or
    // none, gh refuses; a comment whose issue is not read counts nowhere.
    const first = positionals(command.argv, 3)[0]
    if (first === undefined || !isKnown(command, first.index)) return unknown
    const number = /^#?([1-9]\d*)$/.exec(first.value)
    const url = issueUrlArg.exec(first.value)
    if (number) issue = Number(number[1])
    else if (url)
      return {
        project: isProject(`${url[1]}/${url[2]}`),
        issue: Number(url[3]),
        unknown: false,
      }
    else return unknown
  }

  const repoFlag = optionValues(command.argv, ['-R', '--repo']).at(-1)
  const ghRepo = command.env?.GH_REPO ?? process.env.GH_REPO
  const named =
    repoFlag ?? (typeof ghRepo === 'string' && ghRepo !== '' ? ghRepo : null)
  if (named !== null)
    return hasExpansion(named)
      ? unknown
      : { project: isProject(named), issue, unknown: false }

  if (command.cwd === null || command.cwd === undefined)
    return { project: isProject(inputRepo), issue, unknown: false }
  if (hasExpansion(command.cwd)) return unknown
  return {
    project: isProject(repoAt(path.resolve(baseCwd, command.cwd))),
    issue,
    unknown: false,
  }
}

/**
 * Labels of `-l/--label`, repeatable and comma-separated, lowercased:
 * GitHub matches a label name without case, so `-l Bug` puts `bug` on the
 * issue, and its plan is judged as a bug's.
 */
function labelsOf(command) {
  return optionValues(command.argv, ['-l', '--label'])
    .flatMap((value) => value.split(','))
    .map((label) => label.trim().toLowerCase())
    .filter((label) => label !== '')
}

/**
 * Whether a body counts as the plan, and why not when it does not.
 * A comment counts when it opens exactly with `# Plano` (commentOpening).
 * An issue counts when no required section is missing for its kind; with no
 * category label either kind will do, and with both it counts as neither:
 * the gate refuses such an issue, so the plan is not published there yet.
 * @returns {{ counts: boolean, note: string | null }}
 */
function judgeBody(command, kind, baseCwd) {
  const body = readBody(command, baseCwd)
  if (!body.known || typeof body.text !== 'string')
    return {
      counts: false,
      note:
        body.source === 'none' && kind === 'comment'
          ? null
          : `não consegui ler o corpo de \`${shortText(command)}\`; se era o plano, o marcador continua: publique-o com --body-file <arquivo> ou um heredoc.`,
    }
  if (kind === 'comment')
    return { counts: commentOpening(body.text) === 'plan', note: null }

  const { kind: labelKind, found } = kindOf(labelsOf(command))
  if (found.length > 1)
    return {
      counts: false,
      note: `a issue criada leva ${found.join(' e ')} ao mesmo tempo, e o gate a recusa; o marcador do plano continua.`,
    }
  const kinds = labelKind === null ? [featureKind, bugKind] : [labelKind]
  const results = kinds.map((candidate) => ({
    candidate,
    missing: checkSections(body.text, candidate).missing,
  }))
  if (results.some((result) => result.missing.length === 0))
    return { counts: true, note: null }
  const detail = results
    .map(
      ({ candidate, missing }) =>
        `${results.length > 1 ? `como ${candidate}, ` : ''}faltam ${missing.join(', ')}`,
    )
    .join('; ')
  return {
    counts: false,
    note: `a issue criada não conta como publicação do plano (${detail}); o marcador continua.`,
  }
}

/** The project's issue URLs in the tool's stdout, each a whole line, as { url, issue }. */
function issueUrls(toolResponse) {
  const stdout =
    typeof toolResponse === 'string' ? toolResponse : toolResponse?.stdout
  if (typeof stdout !== 'string') return []
  return [...stdout.matchAll(projectIssueUrl)].map((match) => ({
    url: match[0].trim(),
    issue: Number(match[1]),
  }))
}

function acceptedPlan(input) {
  const toolInput = input.tool_input ?? {}
  const toolResponse =
    input.tool_response !== null && typeof input.tool_response === 'object'
      ? input.tool_response
      : {}
  const plan =
    typeof toolInput.plan === 'string'
      ? toolInput.plan
      : typeof toolResponse.plan === 'string'
        ? toolResponse.plan
        : ''
  const planFilePath =
    typeof toolInput.planFilePath === 'string'
      ? toolInput.planFilePath
      : typeof toolResponse.filePath === 'string'
        ? toolResponse.filePath
        : null
  return { plan, planFilePath }
}

const pendingText = (branchIssue) =>
  [
    'Um plano aceito no plan mode não é Approve: o Approve é o comentário do dono na issue, e o dono só aprova o que está publicado lá.',
    'Publique este plano numa issue antes de construir, de um destes jeitos:',
    `- numa issue nova, criada com a label ${agentPlanLabelTransition.to} e a de categoria (${featureKind} ou ${bugKind});`,
    branchIssue === null
      ? '- num comentário cuja primeira linha é exatamente # Plano, na issue do trabalho.'
      : `- num comentário cuja primeira linha é exatamente # Plano, na #${branchIssue}, a issue desta branch.`,
    `Seções obrigatórias de uma feature (${featureKind}): ${headings(featureSections)}.`,
    `Seções obrigatórias de um bug (${bugKind}): ${headings(bugSections)}.`,
    `Até a publicação, editar fora de context/intent/ pede confirmação, e em ${autonomousModes.join(', ')} é negado. Só remove o marcador um gh issue comment ou gh issue create sozinho no comando (um cd antes vale), com o gh do PATH, cuja saída mostre a URL da issue. Depois dele, rode npm run gate de novo.`,
  ].join('\n')

function onExitPlanMode(input, repo, sessionId) {
  const { plan, planFilePath } = acceptedPlan(input)
  writePendingPlan(repo.commonDir, sessionId, {
    schema: 1,
    sessionId,
    branch: repo.branch,
    acceptedAt: new Date().toISOString(),
    planFilePath,
    // By code point, so an accented character is never cut in half.
    planHead: Array.from(plan).slice(0, planHeadLength).join(''),
  })
  return pendingText(issueFromBranch(repo.branch))
}

function onBash(input, baseCwd, sessionId) {
  const text = input.tool_input?.command
  if (typeof text !== 'string') return null
  // Parse before asking git anything: this runs after every Bash call, and
  // nearly all of them publish nothing.
  const parsed = parseCommand(text)
  const attempts = parsed.commands
    .map((command) => ({ command, kind: publicationKind(command) }))
    .filter((attempt) => attempt.kind !== null)
  if (attempts.length === 0) return null

  const repo = repoAt(baseCwd)
  if (repo === null || !isProject(repo)) return null
  if (!pendingPlanExists(repo.commonDir, sessionId)) return null

  // The URL in stdout is gh's word only when gh is the one command the line
  // ran (a cd aside): `x && gh …; echo <url>` prints one without gh, and
  // `gh … -F f && printf … > f` leaves in f what gh never posted.
  const alone =
    attempts.length === 1 &&
    parsed.commands.every(
      (command) =>
        publicationKind(command) !== null || shellMoves.has(command.argv[0]),
    )
  // The spec is silent on which issue a comment goes to; this takes the
  // restrictive side. On a branch that names an issue, the gate reads the
  // plan in force on that issue, so a # Plano posted on another one leaves
  // the old plan and its Approve in force there. A new issue still counts:
  // it is where new work starts.
  const branchIssue = issueFromBranch(repo.branch)
  const urls = issueUrls(input.tool_response)
  const notes = []
  for (const { command, kind } of attempts) {
    const target = targetOf(command, kind, baseCwd, repo)
    if (target.unknown)
      notes.push(
        `não consegui ler em que issue ou repositório \`${shortText(command)}\` publica; se era o plano, o marcador continua: publique-o com o número da issue escrito no comando.`,
      )
    if (!target.project) continue
    if (
      kind === 'comment' &&
      branchIssue !== null &&
      target.issue !== branchIssue
    ) {
      notes.push(
        `\`${shortText(command)}\` comenta na #${target.issue}, mas esta branch é da #${branchIssue}: o plano dela só vale publicado na #${branchIssue}, e o marcador continua.`,
      )
      continue
    }
    const { counts, note } = judgeBody(command, kind, baseCwd)
    if (!counts) {
      if (note !== null) notes.push(note)
      continue
    }
    if (parsed.unparsable) {
      notes.push(
        `não consegui ler o comando inteiro, e \`${shortText(command)}\` publicaria o plano; o marcador continua: publique-o num comando que se leia inteiro.`,
      )
      continue
    }
    if (!alone || !ghOfPath(command)) {
      notes.push(
        `\`${shortText(command)}\` publicaria o plano, mas só conta um gh issue comment ou gh issue create sozinho no comando (um cd antes vale), com o gh do PATH: com outro comando na linha, a URL na saída pode não ser do gh, e o corpo lido agora pode não ser o que ele publicou; o marcador continua.`,
      )
      continue
    }
    const shown = urls.find(
      (found) => kind === 'create' || found.issue === target.issue,
    )
    if (shown === undefined) {
      notes.push(
        `\`${shortText(command)}\` publicaria o plano, mas a saída não mostra a URL da issue; o marcador continua. Confira se a publicação saiu: só uma publicação que mostre a URL o remove.`,
      )
      continue
    }
    // The spec is silent on the gate's cache; removing it is the restrictive
    // side. It was written before this plan, and until the gate runs again
    // it would still read as open, for up to gateTtlHours, a plan the owner
    // has not approved. The cache goes first: if that fails, the marker
    // stays and the catch in main says so.
    rmSync(path.join(repo.gitDir, gateCacheFile), { force: true })
    clearPendingPlan(repo.commonDir, sessionId)
    const { from, to } = agentPlanLabelTransition
    return [
      `plano publicado em ${shown.url}; o marcador foi removido. Se a issue estava em ${from}, troque: gh issue edit ${shown.issue} --remove-label ${from} --add-label ${to}`,
      'Rode npm run gate de novo antes de construir: o cache do gate desta worktree, se havia um, foi removido, porque veio de antes deste plano, que ainda não tem o Approve do dono.',
    ].join('\n')
  }
  return notes.length > 0 ? notes.join('\n') : null
}

async function main() {
  const input = await readInput()
  // Nothing to read, nothing to mark: this event cannot block anyway.
  if (input === null) return null
  if (input.hook_event_name !== undefined && input.hook_event_name !== event)
    return null
  const tool = input.tool_name
  if (tool !== 'ExitPlanMode' && tool !== 'Bash') return null
  const baseCwd = path.resolve(
    typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '.',
  )
  const sessionId =
    typeof input.session_id === 'string' ? input.session_id : null
  try {
    if (tool === 'Bash') return onBash(input, baseCwd, sessionId)
    const repo = repoAt(baseCwd)
    if (repo === null || !isProject(repo)) return null
    return onExitPlanMode(input, repo, sessionId)
  } catch (error) {
    // The tool call already happened and cannot be refused, but a marker
    // that could not be written or checked must not go unnoticed: the agent
    // is told, which is the most this event can restrict.
    return `o hook plan-to-issue falhou (${error?.message ?? error}): o marcador do plano pendente pode não estar certo. Publique o plano numa issue antes de construir.`
  }
}

try {
  const text = await main()
  if (text !== null) process.stdout.write(`${contextOutput(event, text)}\n`)
} catch {
  // readInput never throws; anything else here is a bug in this file, and a
  // PostToolUse hook's failure must not surface as an error on a tool call
  // that already ran.
}
process.exitCode = 0
