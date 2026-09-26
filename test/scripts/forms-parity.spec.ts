import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  agentCreateStateLabels,
  approveHeading,
  branchSectionFor,
  bugSections,
  checkSections,
  closesLine,
  countCriteria,
  criteriaSection,
  emptyFormAnswer,
  featureSections,
  foldHeading,
  issueLinkRefreshWorkflowFile,
  kindOf,
  optionalSections,
  parseBranch,
  parseSections,
  planCitesBranch,
  planHeading,
  readyLabel,
  requiredChecks,
  reviewSignalWorkflow,
  reviewSignalWorkflowFile,
  stateLabels,
} from '../../scripts/loop-sections.mjs'

/**
 * The issue forms, the PR template and the workflows, held to the loop's
 * contracts in scripts/loop-sections.mjs.
 *
 * GitHub writes each form answer under `### <label>`, so a label that drifts
 * from its heading makes every issue opened from that form fail the gate. The
 * files are read as text with a small line parser rather than a YAML library:
 * they are written in one plain shape, and a parser dependency would be one
 * more thing to install for a check this narrow.
 */

const root = path.resolve(__dirname, '..', '..')
const read = (file: string): string =>
  readFileSync(path.join(root, file), 'utf8')

type Scalars = Record<string, string>

interface FormItem {
  type: string
  id: string | undefined
  attributes: Scalars
  validations: Scalars
}

interface Form {
  top: Scalars
  items: FormItem[]
}

const indentOf = (line: string): number => line.length - line.trimStart().length
const isBlockIndicator = (raw: string): boolean => /^[|>][-+]?$/.test(raw)

/** A plain, single- or double-quoted scalar, as these files write them. */
function unquote(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replace(/''/g, "'")
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
    return JSON.parse(value) as string
  return value
}

/** `[a, b]` as a list; anything else as an empty one. */
function flowList(value: string): string[] {
  const inner = /^\[(.*)\]$/.exec(value.trim())
  if (inner === null) return []
  return inner[1]
    .split(',')
    .map(unquote)
    .filter((item) => item !== '')
}

/** The lines of a block scalar after a key at `keyIndent`, dedented. */
function readBlock(
  lines: string[],
  start: number,
  keyIndent: number,
): { text: string; next: number } {
  const taken: string[] = []
  let next = start
  while (
    next < lines.length &&
    (lines[next].trim() === '' || indentOf(lines[next]) > keyIndent)
  ) {
    taken.push(lines[next])
    next += 1
  }
  const written = taken.filter((line) => line.trim() !== '')
  if (written.length === 0) return { text: '', next }
  const margin = Math.min(...written.map(indentOf))
  const text = taken
    .map((line) => line.slice(margin))
    .join('\n')
    .trimEnd()
  return { text, next }
}

/** Top-level scalars and, for each `body` item, its type, id, attributes and validations. */
function parseForm(text: string): Form {
  const lines = text.split(/\r?\n/)
  const form: Form = { top: {}, items: [] }
  let item: FormItem | null = null
  let itemIndent = -1
  let group: 'attributes' | 'validations' | null = null
  let at = 0
  while (at < lines.length) {
    const line = lines[at]
    at += 1
    const matched = /^(\s*)(- )?([\w-]+):(?:[ \t]+(.*))?$/.exec(line)
    if (matched === null || line.trim().startsWith('#')) continue
    const indent = matched[1].length + (matched[2] === undefined ? 0 : 2)
    const key = matched[3]
    const raw = (matched[4] ?? '').trim()
    let value = unquote(raw)
    if (isBlockIndicator(raw)) {
      const block = readBlock(lines, at, indent)
      value = block.text
      at = block.next
    }
    if (indent === 0) {
      form.top[key] = value
      item = null
      continue
    }
    if (matched[2] !== undefined) {
      item = { type: '', id: undefined, attributes: {}, validations: {} }
      form.items.push(item)
      itemIndent = indent
      group = null
    }
    if (item === null) continue
    if (indent === itemIndent) {
      if (key === 'attributes' || key === 'validations') group = key
      else {
        group = null
        if (key === 'type') item.type = value
        if (key === 'id') item.id = value
      }
    } else if (indent > itemIndent && group !== null) {
      item[group][key] = value
    }
  }
  return form
}

/** Every field a form submits (markdown is shown, never submitted). */
const fieldsOf = (form: Form): FormItem[] =>
  form.items.filter((item) => item.type !== 'markdown')
const labelOf = (item: FormItem): string => item.attributes.label ?? ''
const isRequired = (item: FormItem): boolean =>
  item.validations.required === 'true'

/** The issue body GitHub writes from a submitted form. */
function renderIssue(form: Form, answers: Record<string, string>): string {
  return fieldsOf(form)
    .map(
      (field) =>
        `### ${labelOf(field)}\n\n${answers[labelOf(field)] ?? emptyFormAnswer}`,
    )
    .join('\n\n')
}

/** `run:` bodies, inline or block. */
function runBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const found: string[] = []
  lines.forEach((line, index) => {
    const matched = /^(\s*)(- )?run:(?:[ \t]+(.*))?$/.exec(line)
    if (matched === null) return
    const indent = matched[1].length + (matched[2] === undefined ? 0 : 2)
    const raw = (matched[3] ?? '').trim()
    found.push(
      isBlockIndicator(raw) ? readBlock(lines, index + 1, indent).text : raw,
    )
  })
  return found
}

/** Each step of every job, as its own lines, comments dropped. */
function stepsOf(text: string): string[][] {
  const steps: string[][] = []
  let stepsIndent = -1
  let itemIndent = -1
  let current: string[] | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = indentOf(line)
    if (/^\s*steps:\s*$/.test(line)) {
      stepsIndent = indent
      itemIndent = -1
      current = null
      continue
    }
    if (stepsIndent < 0) continue
    if (indent <= stepsIndent) {
      stepsIndent = -1
      current = null
      continue
    }
    if (
      line.trimStart().startsWith('- ') &&
      (itemIndent < 0 || indent === itemIndent)
    ) {
      itemIndent = indent
      current = [line]
      steps.push(current)
    } else current?.push(line)
  }
  return steps
}

/** The value of `key:` in a step, trailing comment dropped. */
function stepField(step: string[], key: string): string | undefined {
  for (const line of step) {
    const matched = new RegExp(`^\\s*(?:- )?${key}:[ \\t]+(.*)$`).exec(line)
    if (matched !== null) return unquote(matched[1].replace(/\s+#.*$/, ''))
  }
  return undefined
}

/** Job ids under `jobs:`, each with its `name:`. */
function jobsOf(text: string): { id: string; name: string | undefined }[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (start < 0) return []
  const jobs: { id: string; name: string | undefined }[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const id = /^ {2}([\w-]+):\s*$/.exec(line)
    if (id !== null) {
      jobs.push({ id: id[1], name: undefined })
      continue
    }
    const name = /^ {4}name:[ \t]+(.+?)\s*$/.exec(line)
    const last = jobs.at(-1)
    if (name !== null && last !== undefined && last.name === undefined)
      last.name = unquote(name[1])
  }
  return jobs
}

/** A block of `key: value` lines under a top-level key, as a map. */
function topMap(text: string, key: string): Scalars {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*$`).test(line),
  )
  const map: Scalars = {}
  if (start < 0) return map
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const entry = /^ {2}([\w-]+):[ \t]+(.+?)\s*$/.exec(line)
    if (entry !== null) map[entry[1]] = unquote(entry[2])
  }
  return map
}

/** A block sequence under `key:` (any indentation), as a list. */
function blockList(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) =>
    new RegExp(`^\\s*${key}:\\s*$`).test(line),
  )
  if (start < 0) return []
  const keyIndent = indentOf(lines[start])
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (indentOf(line) <= keyIndent) break
    const item = /^\s*- (.+?)\s*$/.exec(line)
    if (item !== null) items.push(unquote(item[1]))
  }
  return items
}

const pinned = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/

// ---------------------------------------------------------------------------
// Issue forms

const forms = [
  {
    file: '.github/ISSUE_TEMPLATE/feature.yml',
    kind: 'enhancement',
    sections: featureSections,
    prefix: 'feature',
  },
  {
    file: '.github/ISSUE_TEMPLATE/bug.yml',
    kind: 'bug',
    sections: bugSections,
    prefix: 'fix',
  },
] as const

describe.each(forms)('$file', ({ file, kind, sections, prefix }) => {
  const form = parseForm(read(file))
  const fields = fieldsOf(form)

  it('asks for every required section, as a required textarea labelled with its heading, in order', () => {
    const required = fields.filter(isRequired)
    expect(required.map(labelOf)).toEqual(
      sections.map((section) => section.heading),
    )
    expect(required.every((field) => field.type === 'textarea')).toBe(true)
  })

  it('offers the optional sections, and only those, as fields that are not required', () => {
    const optional = fields.filter((field) => !isRequired(field))
    expect(optional.map(labelOf)).toEqual([...optionalSections])
    expect(
      optional.every((field) => field.validations.required === 'false'),
    ).toBe(true)
  })

  it('describes each required field with the reason loop-sections gives for it', () => {
    for (const section of sections) {
      const field = fields.find((item) => labelOf(item) === section.heading)
      expect(foldHeading(field?.attributes.description ?? '')).toContain(
        foldHeading(section.why),
      )
    }
  })

  it('gives every field a unique id and a unique label', () => {
    const ids = fields.map((field) => field.id)
    expect(ids.every((id) => id !== undefined && /^[\w-]+$/.test(id))).toBe(
      true,
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(fields.map(labelOf)).size).toBe(fields.length)
  })

  it('applies exactly its category label and ready-for-human', () => {
    // A form carries a full plan, so the issue waits for the owner's Approve:
    // not needs-triage (a report without a plan), and never ready-for-agent,
    // which only the owner applies after the Approve.
    const labels = flowList(form.top.labels ?? '')
    expect(kindOf(labels)).toEqual({ kind, found: [kind] })
    expect(labels.filter((label) => stateLabels.includes(label))).toEqual([
      'ready-for-human',
    ])
    expect(agentCreateStateLabels).toContain('ready-for-human')
    expect(labels).toHaveLength(2)
  })

  it('opens with an intro that uses the Approve and plan grammar the gate reads', () => {
    const [intro] = form.items
    expect(intro.type).toBe('markdown')
    const spans = [
      ...(intro.attributes.value ?? '').matchAll(/`([^`]+)`/g),
    ].map((span) => span[1])
    expect(spans.some((span) => approveHeading.test(span))).toBe(true)
    expect(spans.some((span) => planHeading.test(span))).toBe(true)
    // The owner moves the label the form applied to the one the gate wants.
    expect(spans).toContain('ready-for-human')
    expect(spans).toContain(readyLabel)
  })

  const branchHint = /\b[a-z]+\/<número>-<slug>/g
  const hinting = fields.filter(
    (field) => (field.attributes.placeholder ?? '').match(branchHint) !== null,
  )
  const fillBranch = (text: string) =>
    text.replace(/<número>/g, '7').replace(/<slug>/g, 'algo')

  it('hints a branch shape the gate accepts, with the prefix this kind uses', () => {
    const hints = new Set(
      hinting.flatMap((field) =>
        [...(field.attributes.placeholder ?? '').matchAll(branchHint)].map(
          (hint) => hint[0],
        ),
      ),
    )
    expect(hints.size).toBe(1)
    const [hint] = [...hints]
    expect(parseBranch(fillBranch(hint))).toEqual({
      prefix,
      issue: 7,
      slug: 'algo',
    })
  })

  it('hints the branch only in the field the gate reads it from', () => {
    // A hint in any other field sends the branch where branch-in-plan never
    // looks, and every issue filed that way fails the gate.
    expect(hinting.map(labelOf)).toEqual([branchSectionFor(kind)])
  })

  it('yields a body that passes branch-in-plan once the hinted field is filled in as shown', () => {
    const answers: Record<string, string> = {}
    for (const field of fields.filter(isRequired))
      answers[labelOf(field)] = 'Escrito.'
    for (const field of hinting)
      answers[labelOf(field)] = fillBranch(field.attributes.placeholder ?? '')
    const body = renderIssue(form, answers)
    const branch = `${prefix}/7-algo`
    expect(planCitesBranch(body, branch, kind)).toEqual({
      heading: branchSectionFor(kind),
      section: true,
      cited: true,
    })
  })

  it('yields a body that passes the sections and criteria steps once filled in', () => {
    const answers: Record<string, string> = {}
    for (const field of fields.filter(isRequired))
      answers[labelOf(field)] = 'Escrito.'
    // The one prefilled field is the criteria field; criteriaSection proves it.
    const prefilled = fields.find(
      (field) => field.attributes.value !== undefined,
    )
    expect(prefilled).toBeDefined()
    answers[labelOf(prefilled ?? fields[0])] = '- [ ] Um critério verificável.'
    const body = renderIssue(form, answers)
    expect(checkSections(body, kind)).toMatchObject({ missing: [], empty: [] })
    expect(countCriteria(criteriaSection(body))).toBe(1)
  })

  it('yields a body the gate refuses as empty, not missing, when left blank', () => {
    // Private repositories ignore `required`, so a blank form is submitted.
    const body = renderIssue(form, {})
    expect(checkSections(body, kind)).toMatchObject({
      missing: [],
      empty: sections.map((section) => section.heading),
    })
  })

  it('prefills the criteria field with a box that does not count as a criterion', () => {
    const prefilled = fields
      .map((field) => field.attributes.value)
      .filter((value): value is string => value !== undefined)
    expect(prefilled).toHaveLength(1)
    expect(countCriteria(prefilled[0])).toBe(0)
  })
})

describe('.github/ISSUE_TEMPLATE/config.yml', () => {
  const text = read('.github/ISSUE_TEMPLATE/config.yml')

  it('turns blank issues off', () => {
    expect(parseForm(text).top.blank_issues_enabled).toBe('false')
  })

  it('links the workflow guide', () => {
    expect(text).toContain(
      'url: https://github.com/geazioliveira/marketo-sandbox/blob/main/docs/development/workflow.md',
    )
  })
})

// ---------------------------------------------------------------------------
// Pull request template

describe('.github/pull_request_template.md', () => {
  const text = read('.github/pull_request_template.md')
  const [firstLine] = text.split(/\r?\n/)

  it('starts with the line the gate completes into its closing line', () => {
    expect(firstLine).toBe('Closes #')
    expect(closesLine.test(`${firstLine}7.`)).toBe(true)
  })

  it('carries the review sections and the Context Mesh checklist', () => {
    const sections = parseSections(text).filter(
      (section) => section.level === 2,
    )
    expect(sections.map((section) => section.title)).toEqual([
      'Risco',
      'O que mudou',
      'Verificação',
      'Desvios do plano aprovado',
      'Follow-ups',
      'Context Mesh',
    ])
    expect(countCriteria(sections.at(-1)?.content ?? '')).toBe(6)
  })

  it('asks for the Copilot review on the head and zero open threads (#13)', () => {
    const sections = parseSections(text).filter(
      (section) => section.level === 2,
    )
    const verification = sections.find(
      (section) => section.title === 'Verificação',
    )
    expect(verification?.content).toContain('revisão do Copilot na cabeça')
    expect(verification?.content).toContain(
      'zero threads de revisão abertas, cada uma respondida antes de resolvida',
    )
    expect(sections.at(-1)?.content).toContain(
      '- [ ] Revisão do Copilot na cabeça e zero threads abertas (cada uma respondida antes de resolvida)',
    )
  })

  it('closes no issue of its own', () => {
    expect(text).not.toMatch(
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d/i,
    )
  })
})

// ---------------------------------------------------------------------------
// Workflows

const workflows = {
  issueLink: '.github/workflows/issue-link.yml',
  check: '.github/workflows/check.yml',
}

/** A top-level `key: value` scalar. */
function topScalar(text: string, key: string): string | undefined {
  const matched = new RegExp(`^${key}:[ \\t]+(.+?)\\s*$`, 'm').exec(text)
  return matched === null ? undefined : unquote(matched[1])
}

describe('workflows', () => {
  const texts = Object.values(workflows).map(read)

  it('name exactly the required checks, workflow and job, with id and name alike', () => {
    // GitHub shows a check as `<workflow name> / <job name>`, and the rule
    // names the checks that way, so a renamed workflow would leave the rule
    // pointing at a check that no longer runs.
    const checks = texts.flatMap((text) =>
      jobsOf(text).map((job) => ({
        workflow: topScalar(text, 'name'),
        job: job.id,
        name: job.name,
      })),
    )
    expect(checks.every((check) => check.name === check.job)).toBe(true)
    const key = (check: { workflow?: string; job: string }) =>
      `${check.workflow} / ${check.job}`
    expect(checks.map(key).sort()).toEqual(requiredChecks.map(key).sort())
  })

  it('pin every action by a full commit SHA', () => {
    for (const text of texts) {
      const uses = stepsOf(text)
        .map((step) => stepField(step, 'uses'))
        .filter((value): value is string => value !== undefined)
      expect(uses.length).toBeGreaterThan(0)
      for (const action of uses) expect(action).toMatch(pinned)
    }
  })

  it('never interpolate an expression inside a run script', () => {
    for (const text of texts)
      for (const script of runBlocks(text)) expect(script).not.toContain('${{')
  })

  it('never persist checkout credentials', () => {
    for (const text of texts) {
      const checkouts = stepsOf(text).filter((step) =>
        stepField(step, 'uses')?.startsWith('actions/checkout@'),
      )
      expect(checkouts.length).toBeGreaterThan(0)
      for (const step of checkouts)
        expect(stepField(step, 'persist-credentials')).toBe('false')
    }
  })
})

describe(workflows.issueLink, () => {
  const text = read(workflows.issueLink)
  const steps = stepsOf(text)
  const checkouts = steps.filter((step) =>
    stepField(step, 'uses')?.startsWith('actions/checkout@'),
  )

  it('runs from main on pull_request_target, on every event that changes the verdict', () => {
    expect(text).toMatch(/^ {2}pull_request_target:\s*$/m)
    expect(text).not.toMatch(/^ {2}pull_request:/m)
    expect(text).not.toMatch(/^[ \t]+branches:/m)
    expect(blockList(text, 'types').sort()).toEqual(
      [
        'converted_to_draft',
        'edited',
        'opened',
        'ready_for_review',
        'reopened',
        'synchronize',
      ].sort(),
    )
  })

  it('reads with a read-only token, and asks for nothing else', () => {
    expect(topMap(text, 'permissions')).toEqual({
      contents: 'read',
      issues: 'read',
      'pull-requests': 'read',
    })
    expect(text).not.toMatch(/^[ \t]+permissions:/m)
    expect(text).not.toMatch(/:\s*write\b/)
  })

  it('checks out the trusted gate from main and the PR head as data', () => {
    expect(checkouts).toHaveLength(2)
    const [trusted, pr] = checkouts
    expect(stepField(trusted, 'path')).toBe('trusted')
    expect(stepField(trusted, 'ref')).toBeUndefined()
    expect(stepField(trusted, 'sparse-checkout')).toBe('scripts')
    expect(stepField(pr, 'path')).toBe('pr')
    expect(stepField(pr, 'ref')).toBe(
      '${{ github.event.pull_request.head.sha }}',
    )
    expect(stepField(pr, 'fetch-depth')).toBe('0')
    expect(text).not.toMatch(/allow-unsafe-pr-checkout:\s*true/)
  })

  it('runs the trusted gate by absolute path, in CI mode, and installs nothing', () => {
    const scripts = runBlocks(text)
    expect(scripts).toEqual([
      'node "$GITHUB_WORKSPACE/trusted/scripts/gate.mjs" --pr "$PR_NUMBER" --branch "$PR_HEAD_REF"',
    ])
    for (const script of scripts)
      expect(script).not.toMatch(/\b(?:npm|npx|yarn|pnpm)\b/)
    const gate = steps.find((step) => stepField(step, 'run') !== undefined)
    expect(gate && stepField(gate, 'working-directory')).toBe('pr')
    expect(gate && stepField(gate, 'GH_TOKEN')).toBe('${{ github.token }}')
    const node = steps.find((step) =>
      stepField(step, 'uses')?.startsWith('actions/setup-node@'),
    )
    expect(node && stepField(node, 'node-version-file')).toBe('trusted/.nvmrc')
    expect(node && stepField(node, 'package-manager-cache')).toBe('false')
  })
})

describe(workflows.check, () => {
  const text = read(workflows.check)

  it('installs, runs the aggregate check and the e2e, and then refuses a dirty tree', () => {
    // #3 moved lint and test into `npm run check`, the one command a person
    // also runs before the PR; the chain itself is pinned below.
    const scripts = runBlocks(text)
    expect(scripts).toHaveLength(4)
    expect(scripts.slice(0, 3)).toEqual([
      'npm ci',
      'npm run check',
      'npm run test:e2e',
    ])
    expect(scripts.at(-1)).toContain('git status --porcelain')
  })

  it('runs the e2e as its own step, with no environment of its own', () => {
    // Since #9 the app sends no telemetry, so nothing needs pointing away
    // from the network; test/runtime-defaults.spec.ts guards that.
    const e2e = stepsOf(text).find(
      (step) => stepField(step, 'run') === 'npm run test:e2e',
    )
    expect(e2e && stepField(e2e, 'name')).toBe('e2e')
    expect(e2e?.some((line) => /^\s*env:/.test(line))).toBe(false)
    expect(text).not.toContain('OBSERVE_')
  })

  it('relies on a `npm run check` that chains lint, format:check, typecheck, test, check:context, build and check:all', () => {
    const { scripts } = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>
    }
    expect(scripts.check.split(' && ')).toEqual([
      'npm run lint',
      'npm run format:check',
      'npm run typecheck',
      'npm test',
      'npm run check:context',
      'npm run build',
      'npm run check:all',
    ])
    expect(scripts.typecheck).toBe('tsc --noEmit')
    expect(scripts['check:context']).toBe('node scripts/check-context.mjs')
    // check:all runs every generator in --check mode: the committed output is
    // what the generators emit (#7).
    expect(scripts['check:all']).toBe(
      'npm run check:definitions && npm run check:resources && npm run check:factories',
    )
    // The generated header tells the reader to run `npm run generate:<g>`, so
    // those scripts are pinned too.
    expect(scripts['generate:all']).toBe(
      'npm run generate:definitions && npm run generate:resources && npm run generate:factories',
    )
    for (const generator of ['definitions', 'resources', 'factories']) {
      expect(scripts[`check:${generator}`]).toBe(
        `python3 scripts/generate-marketo-${generator}.py --check`,
      )
      expect(scripts[`generate:${generator}`]).toBe(
        `python3 scripts/generate-marketo-${generator}.py`,
      )
    }
    // format:check refuses exactly what `npm run format` would rewrite (#9).
    expect(scripts['format:check']).toBe(
      'prettier --check "src/**/*.ts" "test/**/*.ts" "scripts/**/*.{mjs,mts}"',
    )
    expect(scripts.format).toBe(
      scripts['format:check'].replace('--check', '--write'),
    )
  })

  it('reads the repository with a read-only token', () => {
    expect(topMap(text, 'permissions')).toEqual({ contents: 'read' })
    expect(text).not.toMatch(/:\s*write\b/)
  })

  it('never cancels or replaces a run on main, and supersedes a stale one elsewhere', () => {
    // A group holds one pending run, and a newer one replaces it: on main the
    // group is the commit, so a third push cannot drop the second's verdict.
    expect(topMap(text, 'concurrency')).toEqual({
      group:
        "check-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}",
      'cancel-in-progress': "${{ github.ref != 'refs/heads/main' }}",
    })
  })
})

// ---------------------------------------------------------------------------
// The refresh after a review (#13): an untrusted signal, a trusted refresh

const reviewSignal = `.github/workflows/${reviewSignalWorkflowFile}`
const refresh = `.github/workflows/${issueLinkRefreshWorkflowFile}`

describe('every workflow file', () => {
  const dir = path.join(root, '.github', 'workflows')
  const files = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file))

  it('includes the review signal and the refresh', () => {
    expect(files).toContain(reviewSignalWorkflowFile)
    expect(files).toContain(issueLinkRefreshWorkflowFile)
  })

  // A plain `run:` scalar ends at " #": YAML reads the rest as a comment, and
  // the shell gets a cut command (the signal's first run on PR #15 failed so).
  it('never writes " #" in a one-line run value, where YAML would cut it', () => {
    for (const file of files)
      for (const line of read(`.github/workflows/${file}`).split(/\r?\n/)) {
        const one = /^\s*(?:-\s+)?run:\s*(?![|>])(.*)$/.exec(line)
        if (one !== null) expect(one[1], `${file}: ${line}`).not.toMatch(/\s#/)
      }
  })

  it('never interpolates an expression inside a run script', () => {
    for (const file of files)
      for (const script of runBlocks(read(`.github/workflows/${file}`)))
        expect(script, file).not.toContain('${{')
  })
})

describe(reviewSignal, () => {
  const text = read(reviewSignal)
  const steps = stepsOf(text)

  it('is named as the contract names it, in pt-BR', () => {
    expect(reviewSignalWorkflow).toBe('Sinal de revisão')
    expect(topScalar(text, 'name')).toBe(reviewSignalWorkflow)
  })

  it('runs on a review submitted or dismissed, and on nothing else', () => {
    expect(text).toContain(
      '\non:\n  pull_request_review:\n    types: [submitted, dismissed]\n\n',
    )
    expect(text).not.toMatch(/^ {2}(?:pull_request_target|workflow_run):/m)
  })

  it('holds no permission at all: it runs the pull request own YAML', () => {
    // pull_request_review takes this file from the PR's merge ref: whatever
    // it declared would be the PR's to widen, so it declares nothing.
    expect(text).toMatch(/^permissions: \{\}$/m)
    expect(text.match(/permissions:/g)).toHaveLength(1)
    expect(text).not.toMatch(/:\s*(?:write|read)\b/)
    expect(text).not.toContain('secrets.')
    expect(text).not.toContain('github.token')
  })

  it('runs one short job that checks out nothing, uses no action and runs nothing of the repository', () => {
    expect(jobsOf(text)).toEqual([{ id: 'signal', name: 'signal' }])
    expect(text).toMatch(/^ {4}runs-on: ubuntu-latest$/m)
    expect(text).toMatch(/^ {4}timeout-minutes: 2$/m)
    expect(steps).toHaveLength(1)
    expect(stepField(steps[0], 'uses')).toBeUndefined()
    const scripts = runBlocks(text)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toMatch(/^echo "[^"`$]*\$PR_NUMBER[^"`$]*"$/)
  })

  it('hands the PR number to the shell through env only', () => {
    expect(stepField(steps[0], 'PR_NUMBER')).toBe(
      '${{ github.event.pull_request.number }}',
    )
    for (const script of runBlocks(text)) expect(script).not.toContain('${{')
  })

  it('is no required check', () => {
    expect(requiredChecks.map((check) => check.workflow)).not.toContain(
      reviewSignalWorkflow,
    )
  })

  it('names, in its header, the trusted refresh that answers it', () => {
    const header = text.slice(0, text.indexOf('\nname: '))
    expect(header).toContain('issue-link-refresh.yml')
    expect(header).toContain('workflow_run')
    expect(header).toContain('no permissions')
  })
})

describe(`${refresh}, answering ${reviewSignal}`, () => {
  const text = read(refresh)

  it("answers only the signal's completed runs, by the signal's name", () => {
    // workflow_run matches by name: a rename on either side would silently
    // stop the refresh after a review.
    expect(text).toContain(
      `\n  workflow_run:\n    workflows: ['${reviewSignalWorkflow}']\n    types: [completed]\n`,
    )
    expect(topScalar(read(reviewSignal), 'name')).toBe(reviewSignalWorkflow)
  })

  it('trusts a signal run only when it succeeded', () => {
    expect(text).toContain(
      "(github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success')",
    )
  })

  it('takes a dispatch for one PR, a required number', () => {
    expect(text).toMatch(
      /^ {2}workflow_dispatch:\n {4}inputs:\n {6}pr:\n {8}description: .+\n {8}required: true\n {8}type: number\n/m,
    )
  })

  it('keeps the same permissions: re-run workflows and read, nothing more', () => {
    expect(topMap(text, 'permissions')).toEqual({
      actions: 'write',
      issues: 'read',
      'pull-requests': 'read',
      contents: 'read',
    })
    expect(text).not.toMatch(/^[ \t]+permissions:/m)
  })

  it('checks out the ref it runs from, main by its guard, and nothing of the pull request', () => {
    // Issue events and workflow_run run from the default branch; a
    // workflow_dispatch runs from the ref it was dispatched on, so the job
    // skips a dispatch off main (which only catches accidents).
    expect(text).toContain(
      "(github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main')",
    )
    const checkouts = stepsOf(text).filter((step) =>
      stepField(step, 'uses')?.startsWith('actions/checkout@'),
    )
    expect(checkouts).toHaveLength(1)
    expect(stepField(checkouts[0], 'ref')).toBeUndefined()
    expect(stepField(checkouts[0], 'persist-credentials')).toBe('false')
    expect(text).not.toContain('head_sha }}')
  })
})
