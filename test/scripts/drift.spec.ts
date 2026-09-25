import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  approveHeading,
  branchCategory,
  branchPrefixes,
  bugSections,
  commentOpening,
  featureSections,
  planHeading,
  requiredChecks,
  stepIds,
  withdrawHeading,
} from '../../scripts/loop-sections.mjs'

/**
 * The prose that restates a contract, held to the contract.
 *
 * The docs are for people and scripts/loop-sections.mjs is for the gate, so
 * both homes stay; what must not happen is the two drifting in silence. That
 * is how lite-campaign's gate refused a `fix/` branch its own lifecycle
 * pattern permitted (brunohab/lite-campaign#111).
 */

const root = path.resolve(__dirname, '..', '..')
const read = (file: string): string =>
  readFileSync(path.join(root, file), 'utf8')
const lifecycle = 'context/knowledge/patterns/issue-branch-lifecycle.md'
const loopGate = 'context/knowledge/patterns/loop-gate.md'
const workflowGuide = 'docs/development/workflow.md'

/** The inline code spans of a piece of markdown, in order. */
const spansOf = (text: string): string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1])

/** A `## ` section of a markdown file, from its heading to the next `## `. */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/)
  const start = lines.indexOf(heading)
  if (start < 0) throw new Error(`seção ausente: ${heading}`)
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('## '),
  )
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}

/** Every pipe table in a piece of markdown: header row, then body rows, as cells. */
function tablesOf(markdown: string): string[][][] {
  const tables: string[][][] = []
  let current: string[][] | null = null
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) {
      current = null
      continue
    }
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((cell) => cell.trim())
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    if (current === null) {
      current = []
      tables.push(current)
    }
    current.push(cells)
  }
  return tables
}

/** The first word of an Efeito cell, and what the gate does with that line. */
const effects = new Map<string, ReturnType<typeof commentOpening>>([
  ['Aprova', 'approve'],
  ['Retira', 'withdraw'],
  ['Revisa', 'plan'],
  ['Cancela', 'approve-like'],
  ['Nenhum', null],
])

describe('docs against scripts/loop-sections.mjs', () => {
  it('the lifecycle pattern states exactly the branch shapes the gate accepts', () => {
    const text = read(lifecycle)
    for (const prefix of branchPrefixes)
      expect(text).toContain(`\`${prefix}/<número>-<slug>\``)
    const stated = new Set(
      [...text.matchAll(/`(\w+)\/<número>-<slug>`/g)].map((match) => match[1]),
    )
    expect([...stated].sort()).toEqual([...branchPrefixes].sort())
  })

  it('the lifecycle pattern names, beside each shape, the category it requires', () => {
    // A mention of `bug` anywhere would not do: the doc must say it of `fix/`.
    const lines = read(lifecycle).split(/\r?\n/)
    for (const [prefix, label] of branchCategory) {
      const shape = `\`${prefix}/<número>-<slug>\``
      const stated = lines.filter(
        (line) => line.includes(shape) && line.includes(`\`${label}\``),
      )
      expect(stated, `${shape} com ${label}`).not.toEqual([])
    }
  })

  it('the workflow guide states every required section with its reason, line for line', () => {
    // Headings alone (Plano, Riscos) appear all over the guide, so only the
    // whole `- heading: why.` line proves the contract is restated.
    const lines = new Set(
      read('docs/development/workflow.md')
        .split(/\r?\n/)
        .map((line) => line.trimEnd()),
    )
    for (const { heading, why } of [...featureSections, ...bugSections]) {
      const line = `- ${heading}: ${why}.`
      expect(lines.has(line), line).toBe(true)
    }
  })

  it('the workflow guide’s comment tables give each first line the effect the gate gives it', () => {
    const text = sectionOf(read(workflowGuide), '## Comentários que o gate lê')
    const rows = tablesOf(text).flatMap(([header, ...body]) => {
      const line = header.indexOf('Primeira linha')
      const effect = header.indexOf('Efeito')
      if (line < 0 || effect < 0) return []
      return body.map((cells) => ({ cell: cells[line], effect: cells[effect] }))
    })
    expect(rows.length).toBeGreaterThanOrEqual(10)
    const seen = new Set<ReturnType<typeof commentOpening>>()
    for (const { cell, effect } of rows) {
      // A second span is the line below: `Approve retirado`, com `===` …
      const spans = spansOf(cell)
      expect(spans.length, cell).toBeGreaterThan(0)
      const word = effect.split(/[\s:,.]/)[0]
      expect(effects.has(word), `${cell}: ${effect}`).toBe(true)
      const expected = effects.get(word) ?? null
      expect(commentOpening(spans.join('\n')), cell).toBe(expected)
      // Exactly the one regular expression the row claims, or none of them.
      const [first] = spans
      expect(approveHeading.test(first), cell).toBe(expected === 'approve')
      expect(withdrawHeading.test(first), cell).toBe(expected === 'withdraw')
      expect(planHeading.test(first), cell).toBe(expected === 'plan')
      seen.add(expected)
    }
    expect(seen.size, 'cada efeito tem ao menos um exemplo').toBe(effects.size)
  })

  it('the docs quote as non-revisions only lines that fail planHeading', () => {
    // The spans before "não é revisão" on a line are the lines it describes.
    const claim = /não (?:é|são) revisão/
    const quoted = [workflowGuide, loopGate].flatMap((file) =>
      read(file)
        .split(/\r?\n/)
        .filter((line) => claim.test(line))
        .flatMap((line) => spansOf(line.slice(0, line.search(claim)))),
    )
    for (const example of ['## Plano', '# plano', '# Plano revisado'])
      expect(quoted).toContain(example)
    for (const line of quoted) expect(planHeading.test(line), line).toBe(false)
  })

  it('the loop-gate pattern’s step table lists exactly the gate’s steps, in order', () => {
    const table = tablesOf(read(loopGate)).find(
      ([header]) => header[0] === 'Passo',
    )
    expect(table).toBeDefined()
    const ids = (table ?? [])
      .slice(1)
      .map(([cell]) => /^`([\w-]+)`$/.exec(cell)?.[1])
    expect(ids).toEqual([...stepIds])
  })

  it.each([
    workflowGuide,
    'context/decisions/0002-soft-enforcement-on-github-free.md',
  ])('%s names every required check by workflow and job', (file) => {
    const text = read(file)
    for (const { workflow, job } of requiredChecks)
      expect(text).toContain(`${workflow} / ${job}`)
  })
})
