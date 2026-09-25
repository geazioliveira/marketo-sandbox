// The loop's contracts, in one place.
//
// The gate (scripts/gate.mjs), the CI check (.github/workflows/issue-link.yml
// runs the gate), the issue forms (.github/ISSUE_TEMPLATE/*.yml, held equal by a
// parity test), the Claude Code hooks (#5) and the tests all import from here.
// A rule restated in a second place drifts: lite-campaign's gate once refused a
// `fix/` branch its own lifecycle pattern permitted, because each held a copy
// (brunohab/lite-campaign#111). User-facing text is pt-BR; identifiers and
// tokens stay English (context/decisions/0001-context-mesh-in-the-repository.md).

/** Printed on every gate run, passing ones included. */
export const ownerRule =
  'O dono move a label e escreve o Approve. O agente nunca faz nenhum dos dois.'

// ---------------------------------------------------------------------------
// Branches

/** Branch prefixes the gate accepts. The category a prefix requires is in branchCategory. */
export const branchPrefixes = ['feature', 'fix']

/**
 * The category label a prefix requires: a fix is for a bug. A prefix absent
 * here takes either category.
 */
export const branchCategory = new Map([['fix', 'bug']])

/** `feature/<n>-<slug>` or `fix/<n>-<slug>`: no leading zero, no empty or doubled dash. */
export const branchPattern = new RegExp(
  `^(${branchPrefixes.join('|')})\\/([1-9]\\d*)-([a-z0-9]+(?:-[a-z0-9]+)*)$`,
)

/** How messages name the accepted shapes, built from the list above. */
export const branchShapes = branchPrefixes
  .map((prefix) => `${prefix}/<número>-<slug>`)
  .join(' ou ')

/** @returns {{ prefix: string, issue: number, slug: string } | null} */
export function parseBranch(branch) {
  const matched = branchPattern.exec(branch ?? '')
  if (matched === null) return null
  return { prefix: matched[1], issue: Number(matched[2]), slug: matched[3] }
}

/** The issue a branch names, or null. There is no lane without an issue. */
export function issueFromBranch(branch) {
  return parseBranch(branch)?.issue ?? null
}

// ---------------------------------------------------------------------------
// Labels

/** Exactly one of these on every open issue (the tracking issue excepted). */
export const categoryLabels = ['bug', 'enhancement']

/** Exactly one of these on every open issue. Only the owner moves them. */
export const stateLabels = [
  'needs-triage',
  'needs-info',
  'ready-for-human',
  'ready-for-agent',
  'wontfix',
]

/** The state that lets building start, applied by the owner after the Approve. */
export const readyLabel = 'ready-for-agent'

/** The only state labels the agent may set, and only in `gh issue create`. */
export const agentCreateStateLabels = ['ready-for-human', 'needs-triage']

/** @returns {{ kind: 'bug' | 'enhancement' | null, found: string[] }} */
export function kindOf(labelNames) {
  const found = categoryLabels.filter((name) => labelNames.includes(name))
  return { kind: found.length === 1 ? found[0] : null, found }
}

// ---------------------------------------------------------------------------
// Issue sections

/** What a feature (`enhancement`) plan carries. */
export const featureSections = [
  {
    heading: 'Contexto e porquê',
    why: 'o problema e por que resolvê-lo agora',
  },
  {
    heading: 'Estado atual',
    why: 'citações medidas do código (arquivo:linha, SHA), inclusive o que contradiz o plano',
  },
  {
    heading: 'Critérios de aceite',
    why: 'itens de checklist verificáveis; marcados só em context/intent, nunca no corpo',
  },
  { heading: 'Plano', why: 'os commits em ordem e o nome exato da branch' },
  {
    heading: 'Riscos',
    why: 'HIGH ou NORMAL e o raciocínio, que decide a profundidade da revisão',
  },
  {
    heading: 'Perguntas para o Approve',
    why: 'cada uma com recomendação, alternativa e custo',
  },
]

/** What a bug plan carries: a cause where a feature has a context. */
export const bugSections = [
  {
    heading: 'O que acontece',
    why: 'o comportamento, como quem usa o encontra',
  },
  {
    heading: 'Como reproduzir',
    why: 'os passos, para que a correção tenha algo que falhe antes',
  },
  { heading: 'Causa raiz', why: 'por que acontece, não só onde' },
  {
    heading: 'Onde será corrigido',
    why: 'o arquivo ou a issue que é dona da correção, e o nome exato da branch',
  },
  {
    heading: 'Critérios de aceite',
    why: 'o teste que falha antes e passa depois',
  },
  { heading: 'Riscos', why: 'HIGH ou NORMAL e o raciocínio' },
]

/** Sections a plan may carry; never required. */
export const optionalSections = ['Issue mãe', 'Bloqueada por', 'Fora de escopo']

/** Other pt-BR names accepted for a required heading. English is refused on purpose. */
export const alternativeHeadings = new Map([
  ['Contexto e porquê', ['Contexto', 'Motivação']],
  ['Estado atual', ['Situação atual', 'O que o código diz hoje']],
  ['Critérios de aceite', ['Critérios de aceitação']],
  ['Riscos', ['Risco']],
  [
    'Perguntas para o Approve',
    ['Perguntas para o owner', 'Perguntas para o dono'],
  ],
  ['O que acontece', ['Comportamento atual']],
  ['Como reproduzir', ['Passos para reproduzir', 'Reprodução']],
  ['Onde será corrigido', ['Onde corrigir', 'Correção']],
])

/** Text GitHub issue forms render for an optional field left blank. */
export const emptyFormAnswer = '_No response_'

export function sectionsFor(kind) {
  return kind === 'bug' ? bugSections : featureSections
}

/** Case-, accent- and trailing-punctuation-insensitive form of a heading. */
export function foldHeading(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s:.]+$/, '')
    .trim()
}

/** A required heading and the alternatives accepted for it, folded. */
const acceptedNames = (required) =>
  [required, ...(alternativeHeadings.get(required) ?? [])].map(foldHeading)

/**
 * Whether a heading found in a plan satisfies a required heading or one of
 * its alternatives: it is one of them, or starts with one (`Riscos: HIGH`).
 */
export function matchesHeading(found, required) {
  const folded = foldHeading(found)
  return acceptedNames(required).some((name) => folded.startsWith(name))
}

/**
 * The section that satisfies a required heading, or null. A heading that is
 * exactly the name or an alternative, once folded, wins over one that only
 * starts with it: with `### Plano de testes` before `### Plano`, the plan is
 * `### Plano`. Only when no heading is exact does the first one that starts
 * with the name count (`Riscos: HIGH`).
 */
function pickSection(sections, required) {
  const names = acceptedNames(required)
  return (
    sections.find((section) => names.includes(foldHeading(section.title))) ??
    sections.find((section) => matchesHeading(section.title, required)) ??
    null
  )
}

/**
 * Markdown sections at levels 1–4, skipping fenced code. A section's content
 * runs to the next heading of the same or a higher level, so `### Contratos`
 * inside `## Plano` stays part of the plan.
 * @returns {{ title: string, level: number, content: string }[]}
 */
export function parseSections(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const found = []
  let fence = null
  lines.forEach((line, index) => {
    const opener = /^\s*(`{3,}|~{3,})/.exec(line)
    if (opener) {
      if (fence === null) fence = opener[1][0]
      else if (opener[1][0] === fence) fence = null
      return
    }
    if (fence !== null) return
    const heading = /^(#{1,4})[ \t]+(.+?)[ \t#]*$/.exec(line)
    if (heading)
      found.push({ title: heading[2].trim(), level: heading[1].length, index })
  })
  return found.map((section, i) => {
    const next = found
      .slice(i + 1)
      .find((later) => later.level <= section.level)
    const end = next === undefined ? lines.length : next.index
    return {
      title: section.title,
      level: section.level,
      content: lines
        .slice(section.index + 1, end)
        .join('\n')
        .trim(),
    }
  })
}

/** Whether a section's content counts as written (a blank form field does not). */
export function hasContent(content) {
  const text = String(content ?? '').trim()
  return text !== '' && text !== emptyFormAnswer
}

/** Checklist items (`- [ ]` or `- [x]`) with text after the box. */
export function countCriteria(content) {
  return (String(content ?? '').match(/^\s*[-*] \[[ xX]\] +\S/gm) ?? []).length
}

/**
 * Required sections missing or empty in a plan.
 * @returns {{ missing: string[], empty: string[], sections: ReturnType<typeof parseSections> }}
 */
export function checkSections(planText, kind) {
  const sections = parseSections(planText)
  const missing = []
  const empty = []
  for (const { heading } of sectionsFor(kind)) {
    const hit = pickSection(sections, heading)
    if (hit === null) missing.push(heading)
    else if (!hasContent(hit.content)) empty.push(heading)
  }
  return { missing, empty, sections }
}

/**
 * The section of a plan that satisfies a required heading, the same one
 * checkSections judges, or null: an exact heading first, else the first one
 * that starts with the name (pickSection).
 * @returns {ReturnType<typeof parseSections>[number] | null}
 */
export function findSection(planText, required) {
  return pickSection(parseSections(planText), required)
}

/** The content of the plan's acceptance-criteria section, or '' when it has none. */
export function criteriaSection(planText) {
  return findSection(planText, 'Critérios de aceite')?.content ?? ''
}

/**
 * The section that must name the branch: a feature's `Plano`; a bug plan has
 * none, so its `Onde será corrigido` carries the branch instead.
 */
export function branchSectionFor(kind) {
  return kind === 'bug' ? 'Onde será corrigido' : 'Plano'
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether the plan names the branch exactly, inside the section that carries
 * it (branchSectionFor). A longer name it prefixes does not count, and neither
 * does a mention elsewhere in the plan: "não usar `feature/3-old`" under Fora
 * de escopo cites nothing.
 * @returns {{ heading: string, section: boolean, cited: boolean }}
 */
export function planCitesBranch(planText, branch, kind) {
  const heading = branchSectionFor(kind)
  const section = findSection(planText, heading)
  if (section === null) return { heading, section: false, cited: false }
  const exact = new RegExp(
    `(?<![\\w/.-])${escapeRegExp(String(branch ?? ''))}(?![\\w/-])`,
  )
  return { heading, section: true, cited: exact.test(section.content) }
}

// ---------------------------------------------------------------------------
// Plan, Approve, withdrawal

// Each is matched against the first non-empty line, already trimmed
// (headAndRest), and each is exact: h1, one space, this case, nothing else.

/** A comment whose first line is exactly `# Plano` is a plan revision. `# Plano de testes` is not. */
export const planHeading = /^# Plano[ \t]*$/
/** The first line, nothing else on it: `# Owner Approve`. */
export const approveHeading = /^# Owner Approve$/
/** The first line, nothing else on it: `# Approve retirado`. Tested before the Approve. */
export const withdrawHeading = /^# Approve retirado$/
/**
 * A first line that reads as a heading and mentions Approve, in any case:
 * - an ATX heading, `#` to `######`, whose hashes are followed by a space or
 *   a letter: `#Owner Approve` is a near miss, while `#5 aguarda o Approve`
 *   is an issue reference, not a heading;
 * - a line wholly in bold, `**…**` or `__…__`;
 * - either of those behind blockquote markers (`> # Approve retirado`).
 * Prose that only mentions Approve is none of these. commentOpening adds the
 * setext heading, which takes two lines.
 */
export const approveLikeHeading =
  /^(?=.*approve)(?:>[ \t]*)*(?:#{1,6}(?=[ \t]|\p{L})|\*\*.+\*\*$|__.+__$)/iu

/** The line under a setext heading: only `=` or only `-`, blockquote markers aside. */
const setextUnderline = /^[ \t]*(?:>[ \t]*)*(?:=+|-+)[ \t]*$/

/** First non-empty line, and everything after it. */
export function headAndRest(body) {
  const lines = String(body ?? '').split(/\r?\n/)
  const at = lines.findIndex((line) => line.trim() !== '')
  if (at < 0) return { head: '', rest: '' }
  return {
    head: lines[at].trim(),
    rest: lines
      .slice(at + 1)
      .join('\n')
      .trim(),
  }
}

/**
 * What a comment's opening means to the gate, read from its first non-empty
 * line (trimmed) and, for a setext heading, the line right below it. In this
 * order:
 * - 'withdraw': exactly withdrawHeading;
 * - 'approve': exactly approveHeading;
 * - 'approve-like': any other heading that mentions Approve, which never
 *   counts as one and cancels a standing one (approveLikeHeading, or a first
 *   line that mentions Approve over a setext underline of `=` or `-`);
 * - 'plan': exactly planHeading;
 * - null: an ordinary comment, prose that mentions Approve included.
 * @returns {'withdraw' | 'approve' | 'approve-like' | 'plan' | null}
 */
export function commentOpening(body) {
  const lines = String(body ?? '').split(/\r?\n/)
  const at = lines.findIndex((line) => line.trim() !== '')
  if (at < 0) return null
  const head = lines[at].trim()
  if (withdrawHeading.test(head)) return 'withdraw'
  if (approveHeading.test(head)) return 'approve'
  if (
    approveLikeHeading.test(head) ||
    (/approve/i.test(head) && setextUnderline.test(lines[at + 1] ?? ''))
  )
    return 'approve-like'
  if (planHeading.test(head)) return 'plan'
  return null
}

const byCreatedAt = (a, b) =>
  String(a.createdAt).localeCompare(String(b.createdAt))

/**
 * The plan in force: the latest comment headed `# Plano`, else the issue body.
 * @returns {{ source: 'body' | 'comment', text: string, comment: object | null }}
 */
export function currentPlan({ body, comments = [] }) {
  const plans = [...comments]
    .sort(byCreatedAt)
    .filter((comment) => commentOpening(comment.body) === 'plan')
  const last = plans.at(-1)
  if (last === undefined)
    return { source: 'body', text: String(body ?? ''), comment: null }
  return { source: 'comment', text: headAndRest(last.body).rest, comment: last }
}

const isOwner = (actor, ownerLogin) =>
  actor != null && actor.__typename === 'User' && actor.login === ownerLogin

const after = (time, reference) =>
  Boolean(time) && String(time) > String(reference)
/** At or after: an edit or a deletion in the Approve's own second counts against it. */
const notBefore = (time, reference) =>
  Boolean(time) && String(time) >= String(reference)

/** A first line quoted in a message, cut short so a long one does not flood the report. */
const quoteLine = (line) =>
  `"${line.length > 80 ? `${line.slice(0, 79)}…` : line}"`

/**
 * Whether an owner Approve stands, read from GitHub's GraphQL shape.
 *
 * Comments are read oldest first, by their opening (commentOpening):
 * - exactly `# Owner Approve` is an Approve. It only counts when its author is
 *   the repository owner as a `User` (not a bot or an Actions token), it
 *   carries the owner's own words below the heading, and it is newer than the
 *   issue's last reopening;
 * - exactly `# Approve retirado` withdraws the standing Approve;
 * - any other heading that mentions Approve (an ATX heading of any level, a
 *   setext heading, a line wholly in bold, any of them quoted) is not an
 *   Approve and cancels the standing one: a near-miss withdrawal must not
 *   leave the gate open. Prose that mentions Approve, or `#5` (an issue
 *   reference), changes nothing;
 * - exactly `# Plano` after the Approve cancels it: the plan changed under it.
 *
 * The standing Approve then stops counting when what it approved moved after
 * it: the issue body edited, any other comment edited at or after it, older
 * or newer (a withdrawal or a `# Plano` edited away would otherwise bring the
 * old Approve back with no new act by the owner), or any comment deleted.
 * The Approve's own edits are excepted: those are the owner's words. Edits
 * are measured with `lastEditedAt`, never `updatedAt`, which moves on every
 * label or comment. Last, `ready-for-agent` must have been applied by the
 * owner after the Approve and after the last reopening: the label move is
 * the second deliberate act, so a label left over from before a withdrawal
 * or a revision does not reopen the gate. After a new Approve the owner
 * applies it again (remove, then add).
 *
 * What it cannot see:
 * - the agent posts from the owner's account, so an Approve the agent wrote
 *   in the owner's name looks identical. `ownerRule` states the convention
 *   that covers that gap, and the Claude Code hooks (#5) enforce it;
 * - the Approve's time is its `createdAt`, and its edits are exempt, so a
 *   comment posted before the label and edited into `# Owner Approve` after
 *   it reads as an old Approve followed by the label. Telling them apart
 *   needs the comment's first version (`userContentEdits`). Until then the
 *   owner rule covers it, and the hooks (#5) are to forbid the agent to edit
 *   a comment into an Approve.
 *
 * @param {{
 *   issue: { lastEditedAt?: string | null },
 *   comments: { body: string, createdAt: string, lastEditedAt?: string | null, author?: { __typename?: string, login?: string } | null }[],
 *   events: { __typename: string, createdAt: string, actor?: { __typename?: string, login?: string } | null, label?: { name: string } | null }[],
 *   ownerLogin: string,
 * }} input
 * @returns {{ ok: boolean, code: string, detail: string, approve: object | null }}
 */
export function approveState({
  issue = {},
  comments = [],
  events = [],
  ownerLogin,
}) {
  const timeline = [...events].sort(byCreatedAt)
  const reopenedAt =
    timeline.filter((e) => e.__typename === 'ReopenedEvent').at(-1)
      ?.createdAt ?? ''
  const sorted = [...comments].sort(byCreatedAt)
  let standing = null
  let code = 'none'
  let detail = 'nenhum comentário cuja primeira linha é "# Owner Approve"'

  for (const comment of sorted) {
    const opening = commentOpening(comment.body)
    const { head, rest } = headAndRest(comment.body)
    if (opening === 'withdraw') {
      if (standing !== null) {
        standing = null
        code = 'withdrawn'
        detail = 'o último Approve foi retirado ("# Approve retirado")'
      }
      continue
    }
    if (opening === 'approve') {
      if (!isOwner(comment.author, ownerLogin)) {
        code = 'not-owner'
        detail = `Approve escrito por ${comment.author?.login ?? 'autor desconhecido'} (${comment.author?.__typename ?? '?'}), não pelo dono ${ownerLogin}`
        continue
      }
      if (rest === '') {
        code = 'no-words'
        detail = 'o Approve não traz as palavras do dono abaixo do título'
        continue
      }
      if (reopenedAt !== '' && !after(comment.createdAt, reopenedAt)) {
        code = 'before-reopen'
        detail = 'o Approve é anterior à última reabertura da issue'
        continue
      }
      standing = comment
      code = 'ok'
      continue
    }
    if (opening === 'approve-like') {
      detail = `a primeira linha ${quoteLine(head)} é um título que menciona Approve, mas não é exatamente "# Owner Approve" nem "# Approve retirado"; ${standing === null ? 'não conta como Approve' : 'ela cancela o Approve anterior'}`
      standing = null
      code = 'ambiguous-approve'
      continue
    }
    if (standing !== null && opening === 'plan') {
      standing = null
      code = 'revised'
      detail = 'um "# Plano" foi postado depois do último Approve'
    }
  }

  if (standing === null) return { ok: false, code, detail, approve: null }
  const approvedAt = standing.createdAt

  if (notBefore(issue.lastEditedAt, approvedAt))
    return {
      ok: false,
      code: 'body-edited',
      detail: 'o corpo da issue foi editado depois do Approve',
      approve: null,
    }

  // Whenever it was posted: a comment newer than the Approve, edited, can
  // take back a withdrawal or a revision that had cancelled an older one.
  const edited = sorted.find(
    (comment) =>
      comment !== standing && notBefore(comment.lastEditedAt, approvedAt),
  )
  if (edited !== undefined)
    return {
      ok: false,
      code: 'comment-edited',
      detail: `o comentário de ${edited.createdAt} foi editado depois do Approve (${edited.lastEditedAt}); só o próprio Approve pode ser editado`,
      approve: null,
    }

  const deleted = timeline.find(
    (e) =>
      e.__typename === 'CommentDeletedEvent' &&
      notBefore(e.createdAt, approvedAt),
  )
  if (deleted !== undefined)
    return {
      ok: false,
      code: 'comment-deleted',
      detail: `um comentário foi apagado depois do Approve (${deleted.createdAt})`,
      approve: null,
    }

  const labeled = timeline
    .filter(
      (e) => e.__typename === 'LabeledEvent' && e.label?.name === readyLabel,
    )
    .at(-1)
  if (labeled === undefined)
    return {
      ok: false,
      code: 'label-missing',
      detail: `nenhum evento aplicou ${readyLabel}`,
      approve: null,
    }
  if (!isOwner(labeled.actor, ownerLogin))
    return {
      ok: false,
      code: 'label-not-owner',
      detail: `${readyLabel} foi aplicada por ${labeled.actor?.login ?? 'ator desconhecido'}, não pelo dono`,
      approve: null,
    }
  if (reopenedAt !== '' && !after(labeled.createdAt, reopenedAt))
    return {
      ok: false,
      code: 'label-before-reopen',
      detail: `${readyLabel} é anterior à última reabertura`,
      approve: null,
    }
  if (!after(labeled.createdAt, approvedAt))
    return {
      ok: false,
      code: 'label-before-approve',
      detail: `${readyLabel} foi aplicada em ${labeled.createdAt}, antes do Approve de ${approvedAt}; depois de um Approve novo, o dono aplica a label de novo (remove e adiciona)`,
      approve: null,
    }

  return {
    ok: true,
    code: 'ok',
    detail: `Approve do dono em ${approvedAt}`,
    approve: standing,
  }
}

// ---------------------------------------------------------------------------
// Pull requests, checks, changelog

/** The PR body's first non-empty line, exactly. English: GitHub only reads English keywords. */
export const closesLine = /^Closes #([1-9]\d*)\.$/

/**
 * The checks a merge requires, by workflow and job, as GitHub shows them
 * (`Qualidade / check`): a job of the same name in another workflow does not
 * count, because a pull request can add one. A missing check counts as red.
 */
export const requiredChecks = [
  { workflow: 'Vínculo com issue', job: 'issue-link' },
  { workflow: 'Qualidade', job: 'check' },
]

/** `## AAAA-MM-DD: <o que mudou> (#N)` or `(#N, PR #P)`, for issue N. */
export function changelogHeadingFor(issue) {
  return new RegExp(
    `^## \\d{4}-\\d{2}-\\d{2}: .+ \\(#${issue}(?:, PR #[1-9]\\d*)?\\)$`,
  )
}

/** Any changelog entry heading, for the context checker (#3). */
export const changelogHeading =
  /^## \d{4}-\d{2}-\d{2}: .+ \(#[1-9]\d*(?:, PR #[1-9]\d*)?\)$/

// ---------------------------------------------------------------------------
// The gate's steps and its cache

/** Every step the gate reports, in order. A test pins this list. */
export const stepIds = [
  'repo',
  'pr-base',
  'pr-closes',
  'pr-closes-only',
  'pr-first-line',
  'issue-open',
  'kind',
  'state-label',
  'sections',
  'criteria',
  'approve',
  'branch',
  'branch-in-plan',
  'stacked',
  'size',
  'up-to-date',
  'intent-first',
  'learn',
  'commits-cite-issue',
  'worktree-clean',
  'pushed',
]

/** The loop, as docs/development/workflow.md gives it. */
export const loopSteps = [
  'Issue',
  'Approve',
  'Branch',
  'Intent',
  'Build',
  'Learn',
  'Check',
  'Review',
  'Merge',
]

/** Written only by scripts/gate.mjs, per worktree, under `git rev-parse --absolute-git-dir`. */
export const gateCacheFile = 'loop-gate.json'
export const gateCacheSchema = 1
export const gateTtlHours = 8
/** Written by the plan-to-issue hook (#5) when a plan is accepted in Claude Code and not yet posted. */
export const planPendingPrefix = 'loop-plan-pending-'

/**
 * How a hook reads the cache the gate wrote.
 * @param {object | null} cache the parsed loop-gate.json, or null
 * @param {{ branch: string, now?: number, pendingSince?: string | null }} context
 * @returns {{ state: 'missing' | 'mismatch' | 'stale' | 'pending-plan' | 'unverified' | 'open' | 'closed', cache?: object }}
 */
export function gateStatus(
  cache,
  { branch, now = Date.now(), pendingSince = null },
) {
  if (cache == null) return { state: 'missing' }
  if (
    cache.schema !== gateCacheSchema ||
    cache.branch !== branch ||
    cache.issue !== issueFromBranch(branch)
  )
    return { state: 'mismatch', cache }
  const checked = Date.parse(cache.checkedAt)
  const ageHours = (now - checked) / 36e5
  if (!(ageHours >= 0 && ageHours <= gateTtlHours))
    return { state: 'stale', cache }
  if (pendingSince != null && String(pendingSince) > String(cache.checkedAt))
    return { state: 'pending-plan', cache }
  if (cache.verified !== true) return { state: 'unverified', cache }
  return { state: cache.open === true ? 'open' : 'closed', cache }
}
