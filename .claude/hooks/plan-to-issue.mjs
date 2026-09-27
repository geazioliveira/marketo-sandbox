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
// writes or removes the marker and tells the agent what it did.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  agentPlanLabelTransition,
  bugSections,
  categoryLabels,
  checkSections,
  commentOpening,
  featureSections,
  issueFromBranch,
  kindOf,
  sectionsFor,
} from '../../scripts/loop-sections.mjs'
import { BudgetExhausted, startBudget } from './lib/budget.mjs'
import { githubClient } from './lib/gh-rules.mjs'
import { autonomousModes, contextOutput, readInput } from './lib/io.mjs'
import {
  clearGateCaches,
  clearPendingPlan,
  isProject,
  pendingPlanExists,
  pendingPlanPath,
  projectRepo,
  repoAt,
  writePendingPlan,
} from './lib/repo.mjs'
import {
  findOptions,
  optionValues,
  parseCommand,
  readBody,
} from './lib/shell.mjs'

const event = 'PostToolUse'

/** The tools that run a command line: the ones guard-bash guards. */
const commandTools = ['Bash', 'Monitor', 'mcp__terminal__run_in_terminal']

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
 * Where a publication runs: the directory its `cd` leads to, resolved
 * against the input cwd, and the repository there (Copilot review of #26).
 * A directory spelled with an expansion is not known: which worktree, and so
 * which branch and which caches, cannot be told.
 * @returns {{ known: false } | { known: true, dir: string, repo: object | null }}
 */
function placeOf(command, baseCwd, repoOf) {
  if (typeof command.cwd === 'string' && /[$`]/.test(command.cwd))
    return { known: false }
  const dir = path.resolve(baseCwd, command.cwd ?? '.')
  return { known: true, dir, repo: repoOf(dir) }
}

/**
 * Whether the command posts to this project, and on which issue when it
 * names one. The target is the one gh would use: an issue URL given as the
 * argument, else `-R/--repo`, else GH_REPO, else the repository of the
 * directory the command runs in (its place). A target that cannot be read
 * (an expansion) is `unknown` and counts as another repository: the marker
 * stays, the restrictive side, and the hook says why.
 * @returns {{ project: boolean, issue: number | null, unknown: boolean }}
 */
function targetOf(command, kind, place) {
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

  if (!place.known) return unknown
  return { project: isProject(place.repo), issue, unknown: false }
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
      unread: body.source !== 'none',
      note:
        body.source === 'none' && kind === 'comment'
          ? null
          : `não consegui ler o corpo de \`${shortText(command)}\`; se era o plano, o marcador continua: publique-o com --body-file <arquivo> ou um heredoc.`,
    }
  if (kind === 'comment')
    return { counts: commentOpening(body.text) === 'plan', note: null }
  return planCounts(body.text, labelsOf(command))
}

/**
 * Whether an issue's body counts as the plan, by its category labels: no
 * required section missing for its kind; with no category label either kind
 * will do, and with both it counts as neither.
 * @returns {{ counts: boolean, note: string | null }}
 */
function planCounts(text, labels) {
  const { kind: labelKind, found } = kindOf(labels)
  if (found.length > 1)
    return {
      counts: false,
      note: `a issue criada leva ${found.join(' e ')} ao mesmo tempo, e o gate a recusa; o marcador do plano continua.`,
    }
  const kinds = labelKind === null ? [featureKind, bugKind] : [labelKind]
  const results = kinds.map((candidate) => ({
    candidate,
    missing: checkSections(text, candidate).missing,
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

/**
 * When the session's plan was accepted, in ms: the newest `acceptedAt` of
 * its markers (or the file's time, for a marker that does not say), null
 * when none can be read.
 */
function acceptedTime(commonDirs, sessionId) {
  let latest = null
  for (const dir of commonDirs) {
    const file = pendingPlanPath(dir, sessionId)
    let at = Number.NaN
    try {
      at = Date.parse(JSON.parse(readFileSync(file, 'utf8')).acceptedAt)
    } catch {
      // Not JSON, or no acceptedAt: the file's own time.
    }
    if (Number.isNaN(at))
      try {
        at = statSync(file).mtimeMs
      } catch {
        continue
      }
    latest = latest === null ? at : Math.max(latest, at)
  }
  return latest
}

/**
 * GitHub's own word that a publication run where its output is not read
 * went through (Copilot review of #26): for a comment, one of the account's
 * on the issue, created after the plan was accepted, opening exactly with
 * `# Plano`; for a new issue, one of the account's in this project, created
 * after it, whose body carries the plan's sections (and whose title is the
 * command's, when the command's can be read). One read-only GraphQL call.
 * @returns {{ issue: number, evidence: string } | { note: string }}
 */
function confirmLive(command, kind, target, since, github) {
  const text = shortText(command)
  if (since === null)
    return {
      note: `não consegui ler quando o plano foi aceito, para conferir no GitHub que \`${text}\` o publicou depois; o marcador continua: publique-o pelo Bash, cuja saída mostra a URL.`,
    }
  if (kind === 'comment') {
    const read = github.issueComments(projectRepo, target.issue)
    if (!read.ok)
      return {
        note: `não consegui confirmar no GitHub que \`${text}\` publicou o plano na #${target.issue} (${read.reason}); o marcador continua: publique-o pelo Bash, cuja saída mostra a URL.`,
      }
    const posted = read.value.some(
      (comment) =>
        comment.viewerDidAuthor &&
        Date.parse(comment.createdAt) > since &&
        commentOpening(comment.body) === 'plan',
    )
    return posted
      ? {
          issue: target.issue,
          evidence:
            'um comentário seu que abre com # Plano, de depois do plano aceito',
        }
      : {
          note: `\`${text}\` publicaria o plano, mas o GitHub não mostra na #${target.issue} um comentário seu que abra com # Plano, de depois do plano aceito; o marcador continua. Pelo Monitor ou pelo terminal, o comando pode não ter terminado: confira, e publique pelo Bash se preciso.`,
        }
  }
  const read = github.viewerIssues()
  if (!read.ok)
    return {
      note: `não consegui confirmar no GitHub que \`${text}\` criou a issue do plano (${read.reason}); o marcador continua: publique-o pelo Bash, cuja saída mostra a URL.`,
    }
  const titles = findOptions(command.argv, ['-t', '--title'])
  const title = titles.at(-1)
  const titleKnown = title !== undefined && isKnown(command, title.index)
  const created = read.value
    .filter(
      (issue) =>
        isProject(issue.repo) &&
        Date.parse(issue.createdAt) > since &&
        (!titleKnown || issue.title === title.value) &&
        planCounts(
          issue.body,
          issue.labels.map((label) => label.toLowerCase()),
        ).counts,
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return created.length > 0
    ? {
        issue: created[0].number,
        evidence:
          'uma issue sua neste projeto, com as seções do plano, criada depois do plano aceito',
      }
    : {
        note: `\`${text}\` publicaria o plano, mas o GitHub não mostra uma issue sua neste projeto, criada depois do plano aceito, com as seções do plano${titleKnown ? ` e o título "${title.value}"` : ''}; o marcador continua. Pelo Monitor ou pelo terminal, o comando pode não ter terminado: confira, e publique pelo Bash se preciso.`,
      }
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
    `Até a publicação, editar fora de context/intent/ pede confirmação, e em ${autonomousModes.join(', ')} é negado. Só remove o marcador um gh issue comment ou gh issue create sozinho no comando (um cd antes vale), com o gh do PATH, cuja saída mostre a URL da issue; pelo Monitor ou pelo terminal, sem essa URL, o hook confere a publicação no GitHub. Depois dela, rode npm run gate de novo.`,
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

function onCommand(input, baseCwd, sessionId, { live }) {
  const text = input.tool_input?.command
  if (typeof text !== 'string') return null
  // Parse before asking git anything: this runs after every Bash call, and
  // nearly all of them publish nothing.
  const parsed = parseCommand(text)
  const attempts = parsed.commands
    .map((command) => ({ command, kind: publicationKind(command) }))
    .filter((attempt) => attempt.kind !== null)
  if (attempts.length === 0) return null

  // Each publication is judged where its gh runs (Copilot review of #26): a
  // `cd` before it may lead to another worktree, on another branch, or to
  // another clone. The session's marker lives in the common git dir of the
  // repository it was accepted in: the session's own, or the one the
  // publication runs in, as build-guard reads it.
  const repos = new Map()
  const repoOf = (dir) => {
    if (!repos.has(dir)) repos.set(dir, repoAt(dir))
    return repos.get(dir)
  }
  const inProject = (repo) => repo != null && isProject(repo)
  const marked = (repo) =>
    inProject(repo) && pendingPlanExists(repo.commonDir, sessionId)
  const sessionRepo = repoOf(baseCwd)
  const placed = attempts.map((attempt) => ({
    ...attempt,
    place: placeOf(attempt.command, baseCwd, repoOf),
  }))
  if (
    !marked(sessionRepo) &&
    !placed.some(({ place }) => place.known && marked(place.repo))
  )
    return null

  // The URL in stdout is gh's word only when gh is the one command the line
  // ran (a cd aside): `x && gh …; echo <url>` prints one without gh, and
  // `gh … -F f && printf … > f` leaves in f what gh never posted.
  const alone =
    attempts.length === 1 &&
    parsed.commands.every(
      (command) =>
        publicationKind(command) !== null || shellMoves.has(command.argv[0]),
    )
  const urls = issueUrls(input.tool_response)
  let client = null
  const github = () => {
    client ??= githubClient()
    return client
  }
  const notes = []
  for (const { command, kind, place } of placed) {
    const target = targetOf(command, kind, place)
    if (target.unknown)
      notes.push(
        `não consegui ler em que issue ou repositório \`${shortText(command)}\` publica; se era o plano, o marcador continua: publique-o com o número da issue escrito no comando.`,
      )
    if (!target.project) continue
    if (!place.known) {
      notes.push(
        `não consegui ler em que worktree \`${shortText(command)}\` roda; se era o plano, o marcador continua: publique-o de dentro da worktree, sem cd de variável.`,
      )
      continue
    }
    if (!inProject(place.repo)) {
      notes.push(
        `\`${shortText(command)}\` roda fora de uma worktree deste projeto (${place.dir}); o marcador continua: publique o plano de dentro da worktree da issue.`,
      )
      continue
    }
    // The spec is silent on which issue a comment goes to; this takes the
    // restrictive side. On a branch that names an issue, the gate reads the
    // plan in force on that issue, so a # Plano posted on another one leaves
    // the old plan and its Approve in force there. A new issue still counts:
    // it is where new work starts. The branch is the one checked out where
    // gh runs.
    const branchIssue = issueFromBranch(place.repo.branch)
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
    // Through Monitor or the terminal, a body the hook cannot read may
    // still be the plan: GitHub is asked below.
    const { counts, note, unread } = judgeBody(command, kind, baseCwd)
    if (!counts && !(live && unread)) {
      if (note !== null) notes.push(note)
      continue
    }
    // gh's own word, the URL it printed, counts as it does on Bash.
    let why = null
    let shown
    if (!counts) why = note
    else if (parsed.unparsable)
      why = `não consegui ler o comando inteiro, e \`${shortText(command)}\` publicaria o plano; o marcador continua: publique-o num comando que se leia inteiro.`
    else if (!alone || !ghOfPath(command))
      why = `\`${shortText(command)}\` publicaria o plano, mas só conta um gh issue comment ou gh issue create sozinho no comando (um cd antes vale), com o gh do PATH: com outro comando na linha, a URL na saída pode não ser do gh, e o corpo lido agora pode não ser o que ele publicou; o marcador continua.`
    else {
      shown = urls.find(
        (found) => kind === 'create' || found.issue === target.issue,
      )
      if (shown === undefined)
        why = `\`${shortText(command)}\` publicaria o plano, mas a saída não mostra a URL da issue; o marcador continua. Confira se a publicação saiu: só uma publicação que mostre a URL o remove.`
    }
    let published = null
    if (shown !== undefined)
      published = {
        issue: shown.issue,
        where: `em ${shown.url}`,
      }
    else if (!live) {
      notes.push(why)
      continue
    } else {
      const marks = [place.repo, sessionRepo]
        .filter((repo) => marked(repo))
        .map((repo) => repo.commonDir)
      const confirmed = confirmLive(
        command,
        kind,
        target,
        acceptedTime([...new Set(marks)], sessionId),
        github(),
      )
      if (confirmed.note !== undefined) {
        notes.push(confirmed.note)
        continue
      }
      published = {
        issue: confirmed.issue,
        where: `na issue #${confirmed.issue} (conferido no GitHub: ${confirmed.evidence})`,
      }
    }
    // The spec is silent on the gate's cache; removing it is the restrictive
    // side. It was written before this plan, and until the gate runs again
    // it would still read as open, for up to gateTtlHours, a plan the owner
    // has not approved. The marker is seen from every worktree, so the cache
    // of every worktree goes (Copilot review of #26), in the repository
    // where gh ran and in the session's, when that is another clone of the
    // project. The caches go first: if one removal fails, the markers stay
    // and the catch in main says so.
    const cleared = new Map()
    for (const repo of [place.repo, sessionRepo])
      if (inProject(repo)) cleared.set(repo.commonDir, repo)
    for (const commonDir of cleared.keys()) clearGateCaches(commonDir)
    for (const commonDir of cleared.keys())
      clearPendingPlan(commonDir, sessionId)
    const { from, to } = agentPlanLabelTransition
    return [
      `plano publicado ${published.where}; o marcador foi removido. Se a issue estava em ${from}, troque: gh issue edit ${published.issue} --remove-label ${from} --add-label ${to}`,
      'Rode npm run gate de novo antes de construir: o cache do gate de cada worktree deste repositório, se havia um, foi removido, porque veio de antes deste plano, que ainda não tem o Approve do dono.',
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
  if (tool !== 'ExitPlanMode' && !commandTools.includes(tool)) return null
  const inputCwd = path.resolve(
    typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '.',
  )
  // run_in_terminal takes a cwd of its own, relative to the session's, as
  // guard-bash reads it.
  const ownCwd = input.tool_input?.cwd
  const baseCwd =
    tool === 'mcp__terminal__run_in_terminal' &&
    typeof ownCwd === 'string' &&
    ownCwd !== ''
      ? path.resolve(inputCwd, ownCwd)
      : inputCwd
  const sessionId =
    typeof input.session_id === 'string' ? input.session_id : null
  try {
    startBudget('plan-to-issue')
    if (tool !== 'ExitPlanMode')
      return onCommand(input, baseCwd, sessionId, { live: tool !== 'Bash' })
    const repo = repoAt(inputCwd)
    if (repo === null || !isProject(repo)) return null
    return onExitPlanMode(input, repo, sessionId)
  } catch (error) {
    if (error instanceof BudgetExhausted)
      return `${error.message}. O marcador do plano pendente continua como estava: publique o plano pelo Bash, cuja saída mostra a URL.`
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
