// The loop's contracts, in one place.
//
// The gate (scripts/gate.mjs), the CI check (.github/workflows/issue-link.yml
// runs the gate), the issue forms (.github/ISSUE_TEMPLATE/*.yml, held equal by a
// parity test) and the tests all import from here, and so will the Claude Code
// hooks (#5), which do not exist yet.
// A rule restated in a second place drifts: lite-campaign's gate once refused a
// `fix/` branch its own lifecycle pattern permitted, because each held a copy
// (brunohab/lite-campaign#111). User-facing text is pt-BR; identifiers and
// tokens stay English (context/decisions/0001-context-mesh-in-the-repository.md).

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

/** Exactly one on every open issue. The agent has one post-plan transition below. */
export const stateLabels = [
  'needs-triage',
  'needs-info',
  'ready-for-human',
  'ready-for-agent',
  'wontfix',
]

/** The state that lets building start, applied by the owner after the Approve. */
export const readyLabel = 'ready-for-agent'

/** State labels the agent may set in `gh issue create`. */
export const agentCreateStateLabels = ['ready-for-human', 'needs-triage']

/** The only state-label edit the agent may make after publishing a complete `# Plano`. */
export const agentPlanLabelTransition = Object.freeze({
  from: 'needs-triage',
  to: 'ready-for-human',
})

/**
 * Printed on every gate run, passing ones included. It is built from the
 * labels above, so the rule the gate prints is the one the contract holds.
 */
export const ownerRule = `Ao publicar um plano completo numa issue em ${agentPlanLabelTransition.from}, o agente a troca por ${agentPlanLabelTransition.to}. Só o dono escreve o Approve e aplica ${readyLabel}.`

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
 * An opening fence, with the indentation before it: backticks with no
 * backtick after them, or tildes.
 */
const fenceOpener = /^([ \t]*)(?:(`{3,})[^`]*|(~{3,}).*)$/
/** A line that can close a fence: one run of a fence character, and blanks. */
const fenceCloser = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/
/** The first line of an HTML comment block. */
const commentOpener = /^ {0,3}<!--/
/** A list item: a bullet, or a number with `.` or `)`, then a blank or nothing. */
const listItem = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
/** An ATX heading, which ends any list above it. */
const atxHeading = /^ {0,3}#{1,6}(?:[ \t]|$)/

/** The width of a line's indentation in columns, a tab to the next stop of 4. */
const indentWidth = (indent) =>
  [...indent].reduce(
    (width, char) => (char === '\t' ? width + 4 - (width % 4) : width + 1),
    0,
  )

/**
 * For each line, whether the rendered issue hides its Markdown, and why:
 * `'fence'` for a line of fenced code, `'comment'` for a line of an HTML
 * comment block, false for any other. parseSections and countCriteria both
 * read lines through this one mask, so a heading and a checklist item inside
 * either are skipped alike: a commented-out `## Critérios de aceite` is no
 * section, and a box in sample code is no criterion. hasContent and
 * planCitesBranch drop only the comment lines: fenced code is visible text.
 *
 * Fences follow CommonMark. An opening fence is a run of three or more
 * backticks or tildes, indented at most three spaces; after backticks, the
 * info string holds no backtick. The closing fence is a run of the same
 * character at least as long as the opening one, indented at most three
 * spaces, with nothing after it but spaces or tabs. So inside a three-backtick
 * block a ```` ```js ```` line is code, and inside a four-backtick block a
 * three-backtick line is code too. A fence left open runs to the end.
 *
 * Inside a list item, a fence is indented from the item's text, so it often
 * sits four spaces or more from the margin (`1. Exemplo:` and then a fence
 * indented four spaces). Erring on the side that blocks, an opening fence at
 * any indentation counts when the last non-blank line before it is a list
 * item or a continuation of one: a line indented under it, or a line of text
 * right below it with no blank line between. A heading, a fence or a comment
 * block at the margin, or a line at the margin after a blank one, ends the
 * list. The item's text starts at most three columns left of such a fence,
 * so the fence closes on a closing fence at most three columns right of its
 * opening one, and a non-blank line more than three columns left of it ends
 * the item and the fence with it. Anywhere else, a fence indented four spaces
 * or more is indented code, as before, and a box in it still counts.
 *
 * An HTML comment block starts on a line whose text, after at most three
 * spaces, opens with `<!--`, and runs through the first line from there that
 * holds `-->`, all of that line included: GitHub renders the whole block as
 * HTML, so a box after `-->` on its last line is no list item. One left open
 * runs to the end. A comment that starts inside a line, or on a line indented
 * four spaces or more, is not a block here and hides no whole line;
 * countCriteria, hasContent and planCitesBranch cut those out on their own.
 * @param {string[]} lines
 * @returns {('fence' | 'comment' | false)[]}
 */
function hiddenLines(lines) {
  let fence = null
  let comment = false
  // Whether the last non-blank line read was a list item or a continuation
  // of one, and whether the line before this one was blank.
  let inList = false
  let afterBlank = true
  return lines.map((line) => {
    const blank = line.trim() === ''
    const indent = indentWidth(/^[ \t]*/.exec(line)[0])
    if (fence !== null) {
      // A line left of where the item's text can start ends the item, and a
      // fence inside it with it; the line is then read like any other.
      if (blank || indent >= fence.floor) {
        const closer = fenceCloser.exec(line)
        if (
          closer !== null &&
          indent <= fence.limit &&
          closer[2][0] === fence.run[0] &&
          closer[2].length >= fence.run.length
        )
          fence = null
        return 'fence'
      }
      fence = null
    }
    if (comment) {
      comment = !line.includes('-->')
      return 'comment'
    }
    const nested = inList
    const opener = fenceOpener.exec(line)
    const opensComment = commentOpener.test(line)
    // A line continues an item when it is indented, or when it follows the
    // item with no blank line between and could go on its paragraph: a
    // heading, a fence or a comment block at the margin cannot.
    if (!blank)
      inList =
        listItem.test(line) ||
        (inList &&
          !atxHeading.test(line) &&
          (indent > 0 || (!afterBlank && opener === null && !opensComment)))
    afterBlank = blank
    if (opener !== null && (indent <= 3 || nested)) {
      fence = {
        run: opener[2] ?? opener[3],
        limit: nested ? indent + 3 : 3,
        floor: nested ? indent - 3 : 0,
      }
      return 'fence'
    }
    if (opensComment) {
      comment = !line.includes('-->')
      return 'comment'
    }
    return false
  })
}

/**
 * Markdown sections at levels 1–4, skipping the lines hiddenLines hides:
 * fenced code and HTML comment blocks. A section's content runs to the next
 * heading of the same or a higher level, so `### Contratos` inside
 * `## Plano` stays part of the plan.
 * @returns {{ title: string, level: number, content: string }[]}
 */
export function parseSections(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const hidden = hiddenLines(lines)
  const found = []
  lines.forEach((line, index) => {
    if (hidden[index]) return
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

/**
 * What countCriteria, hasContent and planCitesBranch cut out of the lines
 * hiddenLines leaves as text, in the order tried at each position:
 * 1. a code span on one line, kept: a `<!--` inside it is only text;
 * 2. an HTML comment that opens a line hiddenLines does not read as a block
 *    (indented four spaces or more, or by a tab), through the end of the line
 *    where it closes;
 * 3. any other HTML comment, inline in a line.
 * GitHub renders no comment, and one left open hides the rest of the text. A
 * code span that crosses a line is not recognised, so a `<!--` inside one
 * hides more text, never less. Cutting only ever removes boxes, text and
 * citations, so a misread lands on the side that blocks.
 */
const codeSpanOrComment =
  /(`+)[^`\n]*?\1|^[ \t]*<!--[\s\S]*?(?:-->[^\n]*|(?![\s\S]))|<!--[\s\S]*?(?:-->|(?![\s\S]))/gm

/** Text with its HTML comments cut out and its code spans kept (codeSpanOrComment). */
const cutComments = (text) =>
  text.replace(codeSpanOrComment, (match, ticks) =>
    ticks === undefined ? '' : match,
  )

/**
 * A section's content as the rendered issue shows its words: the lines of an
 * HTML comment block dropped and the other comments cut out, while fenced
 * code stays whole, since a code block is visible text. The cutting runs on
 * each stretch of lines between fences and comment blocks on its own, so a
 * `<!--` inside fenced code hides nothing.
 */
function shownText(content) {
  const lines = String(content ?? '').split(/\r?\n/)
  const hidden = hiddenLines(lines)
  const shown = []
  let stretch = []
  const flush = () => {
    if (stretch.length > 0) shown.push(cutComments(stretch.join('\n')))
    stretch = []
  }
  lines.forEach((line, index) => {
    if (hidden[index] === false) stretch.push(line)
    else {
      flush()
      if (hidden[index] === 'fence') shown.push(line)
    }
  })
  flush()
  return shown.join('\n')
}

/**
 * Whether a section's content counts as written: a blank form field does
 * not, and neither does a section that holds only HTML comments, which
 * GitHub shows empty (`<!-- HIGH ou NORMAL -->`). Fenced code counts.
 */
export function hasContent(content) {
  const text = shownText(content).trim()
  return text !== '' && text !== emptyFormAnswer
}

/**
 * Checklist items (`- [ ]` or `- [x]`) with text after the box, as the
 * rendered issue shows them: a box inside fenced code or inside an HTML
 * comment is an example or a note, not a criterion.
 */
export function countCriteria(content) {
  const lines = String(content ?? '').split(/\r?\n/)
  const hidden = hiddenLines(lines)
  const shown = cutComments(
    lines.filter((_, index) => !hidden[index]).join('\n'),
  )
  return (shown.match(/^\s*[-*] \[[ xX]\] +\S/gm) ?? []).length
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
 *
 * A longer name is the branch followed by a letter, a digit, `_`, `/` or `-`,
 * or by a dot and one of those: git takes `feature/3-a.old` for another branch
 * (branchPattern refuses dots, so the gate never runs on it), while the dot
 * that ends a sentence, `feature/3-a.`, still cites `feature/3-a`. Letters and
 * digits are Unicode ones: `feature/3-a.ção` is a longer name too.
 *
 * The section is read as the rendered issue shows it (shownText): a name
 * only inside an HTML comment cites nothing, while one in fenced code or in
 * a code span does.
 * @returns {{ heading: string, section: boolean, cited: boolean }}
 */
export function planCitesBranch(planText, branch, kind) {
  const heading = branchSectionFor(kind)
  const section = findSection(planText, heading)
  if (section === null) return { heading, section: false, cited: false }
  const nameChar = '[\\p{L}\\p{N}_/-]'
  const exact = new RegExp(
    `(?<![\\p{L}\\p{N}_/.-])${escapeRegExp(String(branch ?? ''))}(?!${nameChar}|\\.${nameChar})`,
    'u',
  )
  return {
    heading,
    section: true,
    cited: exact.test(shownText(section.content)),
  }
}

// ---------------------------------------------------------------------------
// Stacks (#31)
//
// A change too big for one PR is delivered as a stack: small PRs, each one on
// top of the one below, each with its own review and merge. Each slice is a
// sub-issue of the parent issue, and each slice's PR closes its own sub-issue,
// so the link between a PR and an issue, and the audit of main, stay as they
// are. The parent's current plan declares the stack in a `Stack` section: the
// slices' branches, bottom first. A sub-issue that carries stackSliceLabel,
// and no state label, is judged by its parent: the state label, the plan and
// the Approve are the parent's, and its branch must be in that Stack. Every
// revocation of the parent's Approve therefore holds for all its slices.

/** The optional section of a parent's plan that declares its stack. */
export const stackSection = 'Stack'

/** A slice's sub-issue carries it in place of a state label: its state and Approve are the parent's. */
export const stackSliceLabel = 'stack-slice'

/** Lines a PR may change before the report-only pr-size step says it is past the reference. */
export const prSizeLimit = 1500

/**
 * A top-level numbered list item, and its text. It starts at the first
 * column: an indented one may sit inside the item above it, and is prose.
 */
const stackItem = /^\d{1,9}[.)][ \t]+(.*)$/
/**
 * A code span on one line, where a stack item names its branch: a run of
 * backticks, text with none, and a run of the same length, as CommonMark
 * reads it (`x` or ``x``). A branch never holds a backtick, so a span whose
 * text has one names no branch.
 */
const stackCode = /(?<!`)(`+)([^`\n]+)\1(?!`)/g
/** The code span a stack item starts with (stackCode). */
const stackFirstCode = /^(`+)([^`\n]+)\1(?!`)/
/** A heading line: it ends the list of the Stack section. */
const headingLine = /^ {0,3}#{1,6}(?:[ \t]|$)/

/**
 * The stack a plan declares: the branches its `Stack` section names, bottom
 * first. The format is strict, and anything unclear refuses the stack rather
 * than guess:
 * - the section is titled exactly `Stack`, at any heading level: `## Stack`
 *   in a plan comment, `###` or `####` in a plan from an issue form, whose
 *   fields are `###`. A `Stack de PRs` is not it, and two of it are a problem;
 * - the list is the section's numbered items at the first column, up to its first
 *   subheading, outside code blocks and HTML comments (hiddenLines,
 *   shownText); a bullet, a nested item or a paragraph is prose, so a note
 *   that mentions a branch never becomes a slice;
 * - each numbered item starts with the slice's branch in a code span, in a
 *   shape the contract accepts (parseBranch), and names no other branch;
 * - no branch comes twice, and no two branches name the same issue: one
 *   issue has one branch (ADR 0001).
 * `problems` lists what makes the declaration unusable; the gate refuses a
 * slice of a stack with problems.
 * @returns {{ declared: boolean, branches: string[], problems: string[] }}
 */
export function stackOf(planText) {
  const found = parseSections(planText).filter(
    (section) => foldHeading(section.title) === foldHeading(stackSection),
  )
  if (found.length === 0) return { declared: false, branches: [], problems: [] }
  if (found.length > 1)
    return {
      declared: true,
      branches: [],
      problems: [`o plano tem ${found.length} seções ${stackSection}`],
    }
  const branches = []
  const problems = []
  const issueOf = new Map()
  const lines = shownText(found[0].content).split(/\r?\n/)
  const hidden = hiddenLines(lines)
  for (let i = 0; i < lines.length; i += 1) {
    if (hidden[i]) continue
    if (headingLine.test(lines[i])) break
    const item = stackItem.exec(lines[i])
    if (item === null) continue
    const text = item[1].trim()
    const first = stackFirstCode.exec(text)?.[2]?.trim()
    if (first === undefined || parseBranch(first) === null) {
      problems.push(
        `um item numerado da seção ${stackSection} não começa com uma branch: ${text}`,
      )
      continue
    }
    const named = [...text.matchAll(stackCode)]
      .map((match) => match[2].trim())
      .filter((span) => parseBranch(span) !== null)
    if (named.length > 1) {
      problems.push(
        `um item da seção ${stackSection} cita mais de uma branch: ${named.join(', ')}`,
      )
      continue
    }
    if (branches.includes(first)) {
      problems.push(`a seção ${stackSection} cita ${first} mais de uma vez`)
      continue
    }
    const issue = parseBranch(first).issue
    if (issueOf.has(issue)) {
      problems.push(
        `a seção ${stackSection} cita duas branches da #${issue}: ${issueOf.get(issue)} e ${first}; uma issue tem uma branch só`,
      )
      continue
    }
    issueOf.set(issue, first)
    branches.push(first)
  }
  if (branches.length === 0 && problems.length === 0)
    problems.push(`a seção ${stackSection} não cita nenhuma branch`)
  return { declared: true, branches, problems }
}

/**
 * Where a branch sits in a stack's branches (stackOf), bottom first: its
 * index, whether it is the first slice (the bottom, which carries the intent)
 * or the last (the top, which carries the Learn), the branch right below it,
 * and the branches below and above it. null when the stack does not name it.
 * @returns {{ index: number, count: number, first: boolean, last: boolean, below: string | null, lower: string[], upper: string[] } | null}
 */
export function slicePosition(branches, branch) {
  const list = Array.isArray(branches) ? branches : []
  const index = list.indexOf(branch)
  if (index < 0) return null
  return {
    index,
    count: list.length,
    first: index === 0,
    last: index === list.length - 1,
    below: index > 0 ? list[index - 1] : null,
    lower: list.slice(0, index),
    upper: list.slice(index + 1),
  }
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
 * Whose acts count: only the two acts that open the gate check their author,
 * the Approve and the last application of `ready-for-agent`, and both must be
 * the owner's. Every act that closes it counts whoever did it: the withdrawal,
 * a near-miss heading, a `# Plano`, an edit, a deletion, a reopening of the
 * issue and a later application of `ready-for-agent` by another actor (the
 * last application is the one judged) cancel the Approve from another user, a
 * bot or a deleted account (a null author) alike. This is on purpose, not an
 * oversight: a closing act never lets an unapproved plan through, and in
 * doubt the gate blocks. Restricting the exact withdrawal to the owner would
 * not even hold, since its near misses, a `# Plano` or an edit would still
 * cancel. The docs call the withdrawal the owner's act (and it is, by
 * convention); the gate honours it from anyone. A `# Owner Approve` by
 * someone else neither opens the gate nor cancels the owner's standing
 * Approve, while a `ready-for-agent` applied by someone else after the
 * owner's does cancel it.
 *
 * What it cannot see:
 * - the agent posts from the owner's account, so an Approve the agent wrote
 *   in the owner's name looks identical. `ownerRule` states the convention
 *   that covers that gap, and the Claude Code hooks (#5) are to enforce it;
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
 * A closing keyword and the issue it names, the forms GitHub links: `#N`,
 * `owner/repo#N` and the issue's URL, with an optional colon after the
 * keyword.
 */
const closingReference =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?[ \t]+(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)#|#)([1-9]\d*)(?![\w-])/gi

/**
 * The issues a PR body closes, read from its text as GitHub would link them
 * (#31): GitHub links closing keywords only on a PR to the default branch, so
 * a slice's draft PR on the slice below has no link yet, and the gate reads
 * its body instead. HTML comments are left out, as GitHub renders none; code
 * is read, so a keyword shown in code counts, on the side that blocks. Each
 * issue once, in the order found; `repo` is null for a bare `#N`.
 * @returns {{ repo: string | null, number: number }[]}
 */
export function closingRefsOf(body) {
  const found = []
  const seen = new Set()
  for (const match of shownText(body).matchAll(closingReference)) {
    const repo = match[1] ?? match[2] ?? null
    const number = Number(match[3])
    const key = `${String(repo ?? '').toLowerCase()}#${number}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ repo, number })
  }
  return found
}

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
// The Copilot review and the review threads (#13)
//
// Two conditions of a merge: a Copilot review of the commit that is the PR's
// head, and no review thread left unresolved, whoever opened it. The gate's CI
// mode (copilot-review, review-threads), the audit of main and the tests read
// them from here, and so will the hooks of #5 once they exist; until then,
// replying before resolving is a written rule.

/**
 * Who Copilot is, as GraphQL gives a review's author. It is matched by type and
 * database id, never by the login alone: `users/copilot-pull-request-reviewer`
 * on GitHub is an Organization, so a login is only a label for messages.
 */
export const copilotReviewer = {
  typename: 'Bot',
  databaseId: 175728472,
  login: 'copilot-pull-request-reviewer',
}

/**
 * The login that requests a Copilot review over REST (`requested_reviewers`)
 * and GraphQL (`requestReviewsByLogin`, `botLogins`). REST spells the same bot
 * `copilot-pull-request-reviewer[bot]` in a review and `Copilot` in a comment,
 * which is one more reason never to match on a login.
 */
export const copilotRequestLogin = 'copilot-pull-request-reviewer[bot]'

/** The handle gh takes for Copilot: `gh pr edit <n> --add-reviewer @copilot`. */
export const copilotHandle = '@copilot'

/**
 * `word` as one word a POSIX shell reads back unchanged, for a command a
 * person copies from a message: bare when it holds only characters no shell
 * treats specially and does not start with `=` (which zsh, the macOS shell,
 * expands to a command's path), else single-quoted, with a quote inside
 * written '\''.
 * The gate only reaches its review steps with a branch branchPattern accepts,
 * all of whose characters are safe; the quoting keeps a command built from
 * any other value (a fork's branch, a caller that did not check it) from
 * running shell syntax once pasted (Copilot review on PR #15).
 */
export function shellWord(word) {
  const text = String(word)
  return /^[A-Za-z0-9_./:@%+,-][A-Za-z0-9_./:@%+=,-]*$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`
}

/** The command that requests a Copilot review (again) on PR `pr`. */
export function copilotRequestCommand(pr) {
  return `gh pr edit ${shellWord(pr)} --add-reviewer ${copilotHandle}`
}

/**
 * The review states that count as Copilot having reviewed. By default Copilot
 * only leaves COMMENTED reviews; APPROVED is a preview option. DISMISSED,
 * PENDING and CHANGES_REQUESTED do not count.
 */
export const copilotReviewStates = ['COMMENTED', 'APPROVED']

/**
 * From when the audit of main holds a merge to the review rule: PRs merged at
 * or after this instant. #10 and #11 were merged before it, and their threads
 * were handled in #12; #14 already met the rule.
 */
export const reviewRuleSince = '2026-09-25T12:00:00Z'

/** Whether a review's author, as GraphQL gives it, is the Copilot bot (copilotReviewer). */
export function isCopilotReviewer(author) {
  return (
    author != null &&
    author.__typename === copilotReviewer.typename &&
    author.databaseId === copilotReviewer.databaseId
  )
}

/**
 * The start of the body Copilot leaves when a review failed: a COMMENTED
 * review by the Copilot bot, on the head, that reviewed nothing. Measured on
 * GitHub: "Copilot encountered an error and was unable to review this pull
 * request. You can try again by re-requesting a review." (keycloak/keycloak
 * #52793) and "Copilot wasn't able to review any files in this pull request."
 * (Azure/azure-powershell#30106); and, when the requester's quota, billing or
 * eligibility fails, "Copilot was unable to review this pull request because
 * ..." (bsv-blockchain/teranode#1697, onnx/onnx#8217). "was not able" and any apostrophe in
 * "wasn't" read the same, in any case, after any leading white space; the
 * words anywhere later in a body are no failure. Such a review never counts,
 * "any files" included: there is no bypass (ADR 0003), so a PR Copilot
 * cannot review waits, and the audit takes a merge after one as unreviewed.
 */
export const copilotFailedReview =
  /^\s*Copilot (?:encountered an error|was unable to review|(?:was not|wasn['\u2018\u2019\u02BC`\u00B4\u2032\uFF07]t) able to review)/i

/**
 * Whether a review is one of Copilot's failures (copilotFailedReview). A
 * review whose body GitHub did not give as text, or gave empty or blank,
 * shows no sign that Copilot reviewed anything, so it reads as failed: a
 * misread lands on the side that blocks (Copilot review on PR #15).
 */
const failedReview = (review) =>
  typeof review?.body !== 'string' ||
  review.body.trim() === '' ||
  copilotFailedReview.test(review.body)

const bySubmittedAt = (a, b) =>
  String(a.submittedAt ?? '').localeCompare(String(b.submittedAt ?? ''))

/**
 * Whether Copilot reviewed the PR's head, from its reviews as GraphQL gives
 * them. A review counts when its author is the Copilot bot (isCopilotReviewer),
 * its state is one of copilotReviewStates, its `commit.oid` is headRefOid and
 * its body is no failure (copilotFailedReview). `review` is the newest review
 * that counts; `latest` is Copilot's newest review of any state, commit and
 * body, for the message that says what is missing (a review of an older
 * commit, one dismissed, or one that failed), and `failed` says whether
 * `latest` is a failure.
 * @param {{ reviews?: object[] | null, headRefOid: string | null | undefined }} input
 * @returns {{ ok: boolean, review: object | null, latest: object | null, failed: boolean }}
 */
export function copilotReviewOn({ reviews, headRefOid }) {
  const copilot = [...(reviews ?? [])]
    .filter((review) => review != null && isCopilotReviewer(review.author))
    .sort(bySubmittedAt)
  const review =
    copilot
      .filter(
        (candidate) =>
          copilotReviewStates.includes(candidate.state) &&
          typeof headRefOid === 'string' &&
          headRefOid !== '' &&
          candidate.commit?.oid === headRefOid &&
          !failedReview(candidate),
      )
      .at(-1) ?? null
  const latest = copilot.at(-1) ?? null
  return {
    ok: review !== null,
    review,
    latest,
    failed: latest !== null && failedReview(latest),
  }
}

/**
 * Whether a Copilot review is requested and still to come, from the PR's
 * review requests as GraphQL gives them (`reviewRequests` nodes). GitHub drops
 * a request once its review is submitted, so a pending one is a review on its
 * way, whose threads are not there yet. The reviewer is matched as a review's
 * author is (isCopilotReviewer), never by login. Measured on PR #15: GraphQL
 * lists Copilot's pending request as the Bot with its database id, while
 * REST's `requested_reviewers` lists nothing.
 * @param {object[] | null | undefined} requests
 * @returns {boolean}
 */
export function copilotRequested(requests) {
  return (requests ?? []).some(
    (request) =>
      request != null && isCopilotReviewer(request.requestedReviewer),
  )
}

/**
 * The review threads still open: every thread not resolved, whoever opened
 * it, outdated ones included. A thread that does not say it is resolved is
 * open, so a misread lands on the side that blocks.
 * @param {object[] | null | undefined} threads
 * @returns {object[]}
 */
export function openThreads(threads) {
  return (threads ?? []).filter(
    (thread) => thread == null || thread.isResolved !== true,
  )
}

// ---------------------------------------------------------------------------
// Context files, for the context checker (#3)
//
// context/README.md states these for people ("Layout", "Vocabulário de
// status" and "O bloco Status"); scripts/check-context.mjs holds every file to
// them, and its spec holds the README to these lists.

/** Status tokens of the project intent and of a feature. */
export const intentStatuses = [
  'Draft',
  'In Progress',
  'Completed',
  'Deprecated',
]

/** Status tokens of a bug: a bug ends Resolved, never Completed. */
export const bugStatuses = ['Draft', 'In Progress', 'Resolved', 'Deprecated']

/** Status tokens of a decision (ADR). */
export const decisionStatuses = [
  'Proposed',
  'Accepted',
  'Superseded',
  'Deprecated',
]

/** Status tokens of a pattern, of an anti-pattern and of an agent. */
export const knowledgeStatuses = ['Active', 'Superseded', 'Deprecated']

/**
 * Each kind of file under context/: the path it lives at (relative to
 * context/), as a pattern and as the shape the guide's Layout table writes,
 * the kind its title declares (`# <kind>: <título>`) and the statuses its
 * Status block may hold. A decision's title carries its number too:
 * decisions/0001-*.md declares `ADR 0001`.
 */
export const contextKinds = [
  {
    kind: 'Project intent',
    file: /^intent\/project-intent\.md$/,
    shape: 'intent/project-intent.md',
    statuses: intentStatuses,
  },
  {
    kind: 'Feature',
    file: /^intent\/feature-[^/]+\.md$/,
    shape: 'intent/feature-<slug>.md',
    statuses: intentStatuses,
  },
  {
    kind: 'Bug',
    file: /^intent\/bug-[^/]+\.md$/,
    shape: 'intent/bug-<slug>.md',
    statuses: bugStatuses,
  },
  {
    kind: 'ADR',
    file: /^decisions\/(\d{4})-[^/]+\.md$/,
    shape: 'decisions/NNNN-<slug>.md',
    statuses: decisionStatuses,
  },
  {
    kind: 'Pattern',
    file: /^knowledge\/patterns\/[^/]+\.md$/,
    shape: 'knowledge/patterns/<nome>.md',
    statuses: knowledgeStatuses,
  },
  {
    kind: 'Anti-pattern',
    file: /^knowledge\/anti-patterns\/[^/]+\.md$/,
    shape: 'knowledge/anti-patterns/<nome>.md',
    statuses: knowledgeStatuses,
  },
  {
    kind: 'Agent',
    file: /^agents\/agent-[^/]+\.md$/,
    shape: 'agents/agent-<nome>.md',
    statuses: knowledgeStatuses,
  },
]

/**
 * The paths under context/ (relative to it) that have no title kind and no
 * Status block: every index (a README.md in any folder), the glossary, the
 * changelog, and evolution/'s archived history and learning notes. Any other
 * file under context/ is outside the layout, and the checker refuses it.
 */
export const untypedContextPaths = [
  { file: /^(?:[^/]+\/)*README\.md$/, shape: 'README.md' },
  { file: /^knowledge\/glossary\.md$/, shape: 'knowledge/glossary.md' },
  { file: /^evolution\/changelog\.md$/, shape: 'evolution/changelog.md' },
  { file: /^evolution\/history\/[^/]+\.md$/, shape: 'evolution/history/' },
  {
    file: /^evolution\/learning-[^/]+\.md$/,
    shape: 'evolution/learning-<slug>.md',
  },
]

/** Whether a path under context/ (relative to it) is one of untypedContextPaths. */
export function isUntypedContextFile(file) {
  const relative = String(file ?? '')
  return untypedContextPaths.some(({ file: pattern }) => pattern.test(relative))
}

/**
 * What a file under context/ must declare, from its path relative to
 * context/: the title kind (`ADR 0001` for a decision) and its statuses. Null
 * for a path that is no kind: an untyped file (an index wins over its folder:
 * knowledge/patterns/README.md is no pattern), or one outside the layout.
 * @returns {{ kind: string, title: string, statuses: string[] } | null}
 */
export function contextKindOf(file) {
  const relative = String(file ?? '')
  if (isUntypedContextFile(relative)) return null
  for (const { kind, file: pattern, statuses } of contextKinds) {
    const matched = pattern.exec(relative)
    if (matched !== null)
      return {
        kind,
        title: matched[1] === undefined ? kind : `${kind} ${matched[1]}`,
        statuses,
      }
  }
  return null
}

/** The heading of the one Status block every typed context file carries, as its last section. */
export const statusHeading = /^## Status[ \t]*$/

/** The line of the Status block that declares the status: `- **Status**: <token>`. */
export const statusLine = /^- \*\*Status\*\*:[ \t]*(.*?)[ \t]*$/

/**
 * Any line that declares a status: quoted (`>`) or not, in a bulleted or an
 * ordered list or not, bold with `**` or with `__`, the colon inside the bold
 * or after it. Only the Status block's one statusLine may: anywhere else a
 * second status would contradict the block.
 */
export const statusDeclaration =
  /^[ \t]*(?:>[ \t]*|(?:[-*+]|\d{1,9}[.)])[ \t]+)*(\*\*|__)Status(?:\1[ \t]*:|:\1)/

/**
 * Where a link in the PR template must point. The template becomes a PR body,
 * where a relative link resolves against the PR's page and 404s, so a link
 * there is to a file of main on GitHub, or there is no link.
 */
export const repositoryFileUrl =
  'https://github.com/geazioliveira/marketo-sandbox/blob/main/'

// ---------------------------------------------------------------------------
// The gate's steps and its cache

/** Every step the gate reports, in order. A test pins this list. */
export const stepIds = [
  'repo',
  'pr-base',
  'pr-closes',
  'pr-closes-only',
  'pr-first-line',
  'copilot-review',
  'review-threads',
  'pr-size',
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
/**
 * The prefix of the pending-plan marker: the plan-to-issue hook (#5) is to
 * write one, under the repository's common git dir, when a plan is accepted
 * in Claude Code, and to remove it only once the plan is posted on an issue.
 */
export const planPendingPrefix = 'loop-plan-pending-'

/**
 * The file name of Claude Code session `sessionId`'s pending-plan marker:
 * planPendingPrefix, the id encoded, and `.json`.
 *
 * The encoding keeps [A-Za-z0-9-] and writes every other UTF-8 byte, `_`
 * included, as `_XX` in uppercase hex (a lone surrogate, which UTF-8 cannot
 * hold, as `_u` and its code unit in four). So a session id never names a
 * path outside the git dir, a UUID keeps its own spelling, and two ids never
 * share a file: making each character outside the set `_` gave `a/b` and
 * `a_b` one marker, and one session's publication removed the other's
 * (Copilot review of #26, fifth round). No id at all (null, undefined, '')
 * is a lone `_`, which no id encodes to: every `_` of an encoded id is
 * followed by its escape.
 *
 * The plan-to-issue hook (#5) is to keep a copy for when this module fails to
 * load, held equal to this one by its test.
 */
export function planPendingFile(sessionId) {
  const id = String(sessionId ?? '')
  if (id === '') return `${planPendingPrefix}_.json`
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
  return `${planPendingPrefix}${encoded}.json`
}

/**
 * How a hook reads the cache the gate wrote. A plan accepted and not yet
 * posted (`pendingPlan`: its marker exists) keeps the cache closed however
 * recently the gate ran: the plan is published first, and only its
 * publication removes the marker.
 * @param {object | null} cache the parsed loop-gate.json, or null
 * @param {{ branch: string, now?: number, pendingPlan?: boolean }} context
 * @returns {{ state: 'missing' | 'mismatch' | 'stale' | 'pending-plan' | 'unverified' | 'open' | 'closed', cache?: object }}
 */
export function gateStatus(
  cache,
  { branch, now = Date.now(), pendingPlan = false },
) {
  if (pendingPlan === true)
    return cache == null
      ? { state: 'pending-plan' }
      : { state: 'pending-plan', cache }
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
  if (cache.verified !== true) return { state: 'unverified', cache }
  return { state: cache.open === true ? 'open' : 'closed', cache }
}

// ---------------------------------------------------------------------------
// The audit of main and the issue-link refresh (#3)

/**
 * The audit's baseline: 8d4662f, the merge of #2's PR (#10). Commits reachable
 * from it are never audited by scripts/audit-main.mjs. Up to fb4a804 there was
 * no loop, and #2's merge is the bootstrap exception: it brought the
 * server-side issue-link check, so no such check could be green on it. A range
 * that reaches back past it (a force-push, a first audit with no run before
 * it) does not open one issue per old commit.
 */
export const auditBaseline = '8d4662fa54b217d6471e8b197a8d15cf897f65e1'

/**
 * The workflow file of `Auditoria de main`. The head of its newest run on
 * main older than the current one whose auditJudgeStep succeeded is where the
 * current audit's range starts.
 */
export const mainAuditWorkflowFile = 'main-audit.yml'

/** The title of an audit issue, before the commit's short SHA. */
export const auditTitlePrefix = 'Mudança em main fora do loop: '

/** The audit issue's title for a commit: the prefix and the first seven characters of its SHA. */
export function auditTitleFor(sha) {
  return `${auditTitlePrefix}${String(sha ?? '').slice(0, 7)}`
}

/**
 * The labels an audit issue opens with: its category, and needs-triage, the
 * one state label a report may carry at creation (agentCreateStateLabels).
 */
export const auditLabels = ['bug', 'needs-triage']

/**
 * The most first-parent commits one audit may find in its range and still
 * judge one by one. A merge adds one commit to main's first-parent chain, so a
 * range past this is out of the loop as a whole, and the audit records it once
 * instead of asking GitHub about every commit.
 */
export const auditCommitCap = 200

/**
 * The most commits out of the loop one audit opens an issue for each. Past
 * this, one issue on the audited tip lists them all, so a burst of direct
 * commits neither floods the tracker nor runs into GitHub's limit on content
 * creation.
 */
export const auditIssueCap = 10

/**
 * How many more times the audit asks GitHub about a merge commit it links to
 * no PR yet, before judging it a direct commit.
 */
export const auditLinkRetries = 3

/** The wait before each of those asks, in ms (AUDIT_RETRY_DELAY_MS replaces it). */
export const auditRetryDelayMs = 10_000

/**
 * The step of main-audit.yml that judges the range and files the issues. A
 * run counts as audited, and the next audit's range starts at its head, only
 * when this step concluded success in it: a run that stopped halfway judged
 * nothing to rely on, whatever the run's own conclusion.
 */
export const auditJudgeStep = 'Julgar'

/** The step after it, which turns the count Julgar left into the run's color. */
export const auditVerdictStep = 'Veredito'

/** The file, under RUNNER_TEMP, where Julgar leaves that count for Veredito. */
export const auditVerdictFile = 'audit-verdict'

/**
 * How many of main-audit.yml's latest completed runs on main the audit reads,
 * looking for the newest older than itself whose Julgar succeeded.
 */
export const auditRunsRead = 20

/**
 * The page the audit reads a merged PR's head checks with: its check suites,
 * and each suite's check runs. A head holding more than this in either is
 * not judged green or red: its merge is out of the loop for that reason
 * alone, since a re-run would read the same page.
 */
export const auditChecksPage = 100

/**
 * The page the audit reads a merged PR's closing references with, GraphQL's
 * largest. When there are more and none of those read is an issue of this
 * repository, the merge is out of the loop for that reason alone.
 */
export const auditClosingPage = 100

/** When the daily audit runs: 06:17 UTC, as main-audit.yml's schedule. */
export const auditCron = '17 6 * * *'

/** The workflow file of `Vínculo com issue`, whose runs the refresh re-runs. */
export const issueLinkWorkflowFile = 'issue-link.yml'

/**
 * The event the issue-link check must run on to count, and the file it must
 * run from. Only pull_request_target takes the YAML from main: a PR can add a
 * workflow of the same name, or give issue-link.yml a pull_request trigger,
 * and that run would judge the PR with the PR's own copy. The audit accepts,
 * and the refresh re-runs, only a run of this event from this file.
 */
export const issueLinkEvent = 'pull_request_target'
export const issueLinkWorkflowPath = `.github/workflows/${issueLinkWorkflowFile}`

/**
 * How often the refresh asks about an issue-link run still in progress, and
 * how long it waits for it, in ms, inside the job's five minutes
 * (REFRESH_POLL_MS and REFRESH_WAIT_MS replace them).
 */
export const refreshPollMs = 15_000
export const refreshWaitMs = 240_000

/**
 * The strings that make GitHub skip every push and pull_request run of a
 * commit whose message holds one. A merge commit's message is the PR's title
 * and body, so none may appear there nor in any commit message: a merge
 * carrying one gets neither its audit run nor its Qualidade run, and a PR
 * head carrying one gets no Qualidade check. The hooks of #5 are to refuse
 * them; until then, the written rule does.
 */
export const skipCiTokens = [
  '[skip ci]',
  '[ci skip]',
  '[no ci]',
  '[skip actions]',
  '[actions skip]',
]

/**
 * The trailer that also makes GitHub skip a push's runs: a last paragraph
 * `skip-checks: true`, after two empty lines. Forbidden in PR titles, bodies
 * and commit messages for the same reason as skipCiTokens.
 */
export const skipChecksTrailer = 'skip-checks: true'

// ---------------------------------------------------------------------------
// The review signal, the PR refresh and the audit's review pages (#13)

/**
 * The name of .github/workflows/review-signal.yml (reviewSignalWorkflowFile),
 * which issue-link-refresh.yml's workflow_run trigger names: workflow_run
 * matches a workflow by this name, so a rename on either side silently stops
 * the refresh after a review.
 */
export const reviewSignalWorkflow = 'Sinal de revisão'
export const reviewSignalWorkflowFile = 'review-signal.yml'

/** The workflow that re-runs the issue-link check from main (#3, #13). */
export const issueLinkRefreshWorkflowFile = 'issue-link-refresh.yml'

/**
 * The command that asks the refresh to re-run one PR's issue-link, through
 * its workflow_dispatch input `pr`. A dispatch runs the YAML and the script of
 * the ref it names, not of main, hence `--ref main`. It returns before the
 * refresh runs, and a failed refresh shows nothing on the PR, so it only
 * brings the PR's check up to date: it is no fresh verdict before a merge
 * (gateCiCommand, or a re-run of the issue-link watched to its end, is).
 */
export function refreshPrCommand(pr) {
  return `gh workflow run ${issueLinkRefreshWorkflowFile} --ref main -f pr=${shellWord(pr)}`
}

/**
 * The gate in CI mode for PR `pr` over branch `branch`, run in a checkout of
 * the PR's head with origin/main fetched: one of the two fresh verdicts
 * before a merge, when it exits 0. The other is `gh run rerun <id>` of the
 * PR's issue-link run followed by `gh run watch <id> --exit-status`.
 */
export function gateCiCommand(pr, branch) {
  return `node scripts/gate.mjs --pr ${shellWord(pr)} --branch ${shellWord(branch)}`
}

/**
 * The page the audit reads a merged PR's reviews (the newest) and its review
 * threads with, GraphQL's largest. A Copilot review on the head among the
 * reviews read is enough, as the unread cannot undo it; with none among them,
 * or with more threads than the page, the merge is out of the loop for that
 * reason alone, as a re-run would read the same page.
 */
export const auditReviewPage = 100
