import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  approveHeading,
  auditBaseline,
  auditChecksPage,
  auditClosingPage,
  auditCommitCap,
  auditCron,
  auditIssueCap,
  auditJudgeStep,
  auditLinkRetries,
  auditRetryDelayMs,
  auditReviewPage,
  auditRunsRead,
  auditTitlePrefix,
  auditVerdictStep,
  branchCategory,
  branchPrefixes,
  bugSections,
  commentOpening,
  copilotFailedReview,
  copilotHandle,
  copilotRequestCommand,
  copilotRequestLogin,
  copilotReviewer,
  copilotReviewStates,
  featureSections,
  gateCiCommand,
  issueLinkEvent,
  issueLinkRefreshWorkflowFile,
  issueLinkWorkflowPath,
  planHeading,
  refreshPollMs,
  refreshPrCommand,
  refreshWaitMs,
  requiredChecks,
  reviewRuleSince,
  skipCiTokens,
  skipChecksTrailer,
  stepIds,
  ownerRule,
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
const adr0001 = 'context/decisions/0001-context-mesh-in-the-repository.md'
const adr0002 = 'context/decisions/0002-soft-enforcement-on-github-free.md'
const mainAudit = '.github/workflows/main-audit.yml'
const adr0003 =
  'context/decisions/0003-copilot-review-and-no-open-threads-before-merge.md'

/** A doc's sentences: split after `.`, `;` or `:` followed by white space. */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.;:])\s+/)

/**
 * A doc without its Status block: a decision keeps every Atualizado line as
 * the record of what was true then, so a value a later line changed may
 * still stand there.
 */
const bodyOf = (text: string): string => text.split(/\n## Status\n/)[0]

/** Every number a pattern's first group captures in a piece of text. */
const numbersIn = (text: string, pattern: RegExp): number[] =>
  [...text.matchAll(pattern)].map((match) => Number(match[1]))

/**
 * A top-level map of a workflow, `key:` then `  name: value` lines, read as
 * text: the workflows are written in one plain shape (see forms-parity).
 */
function topMap(yaml: string, key: string): Record<string, string> {
  const lines = yaml.split(/\r?\n/)
  const start = lines.indexOf(`${key}:`)
  if (start < 0) throw new Error(`chave ausente: ${key}`)
  const map: Record<string, string> = {}
  for (const line of lines.slice(start + 1)) {
    const entry = /^ {2}([\w-]+):[ \t]*(\S+)[ \t]*$/.exec(line)
    if (entry === null) break
    map[entry[1]] = entry[2]
  }
  return map
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to dashes. */
const slugOf = (heading: string): string =>
  heading
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')

/** The anchors the ATX headings of a markdown file generate. */
const anchorsOf = (markdown: string): Set<string> =>
  new Set(
    markdown
      .split(/\r?\n/)
      .map((line) => /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line))
      .filter((heading): heading is RegExpExecArray => heading !== null)
      .map((heading) => slugOf(heading[1])),
  )

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
  it('the gate pattern quotes the rule the gate prints on every run', () => {
    const quoted = read(loopGate)
      .split(/\r?\n/)
      .filter((line) => line.startsWith('> '))
      .map((line) => line.slice(2).replaceAll('`', ''))
    expect(quoted).toContain(ownerRule)
  })

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

  it.each([workflowGuide, adr0002])(
    '%s names every required check by workflow and job',
    (file) => {
      const text = read(file)
      for (const { workflow, job } of requiredChecks)
        expect(text).toContain(`${workflow} / ${job}`)
    },
  )
})

describe('docs against the audit of main and the quality check', () => {
  it.each([workflowGuide, adr0002, 'AGENTS.md'])(
    '%s quotes the audit issue title as the audit writes it',
    (file) => {
      expect(read(file)).toContain(`\`${auditTitlePrefix}<sha7>\``)
    },
  )

  it.each([workflowGuide, adr0002])(
    '%s states the audit cap and the baseline the audit holds',
    (file) => {
      const text = read(file)
      const baseline = auditBaseline.slice(0, 7)
      expect(text).toContain(`mais de ${auditCommitCap} commits`)
      // The SHA the doc gives the constant's name, and every "até `<sha>`"
      // in a sentence about what is audited, is the baseline: a doc may still
      // name fb4a804, but only as where the loop began.
      const named = [...text.matchAll(/`([0-9a-f]{7,40})` \(`auditBaseline`/g)]
      expect(named.length, file).toBeGreaterThan(0)
      for (const [, sha] of named) expect(sha).toBe(baseline)
      const bounds = text
        .split(/(?<=[.;:])\s+/)
        .filter((sentence) => /auditad|auditoria/i.test(sentence))
        .flatMap((sentence) => [
          ...sentence.matchAll(/até `([0-9a-f]{7,40})`/g),
        ])
      expect(bounds.length, file).toBeGreaterThan(0)
      for (const [, sha] of bounds) expect(sha, file).toBe(baseline)
    },
  )

  it('the Check section lists the chain npm run check runs, in order', () => {
    const { scripts } = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>
    }
    const chain = scripts.check.split(' && ')
    const line = sectionOf(read(workflowGuide), '## Check')
      .split(/\r?\n/)
      .find((text) => text.startsWith('- **`npm run check`**'))
    expect(line).toBeDefined()
    const stated = spansOf(line ?? '').filter(
      (span) => /^npm (?:run |test$)/.test(span) && span !== 'npm run check',
    )
    expect(stated).toEqual(chain)
  })

  it('no doc says the audit reads a branch’s intent or Learn commits', () => {
    // The audit reads main's first-parent line only: a merged PR is one
    // commit there, and the branch's own commits are the gate's to judge.
    const files = [
      adr0001,
      adr0002,
      workflowGuide,
      loopGate,
      lifecycle,
      'AGENTS.md',
    ]
    for (const file of files)
      for (const sentence of read(file).split(/(?<=[.;:])\s+|\|/))
        if (/auditoria/i.test(sentence))
          expect(sentence, file).not.toMatch(/commits? de (?:intent|Learn)/i)
  })

  it('a folder or file the docs say is still to come does not exist yet', () => {
    // "(chega com a #4)" beside a path that already holds files is stale.
    for (const file of [workflowGuide, 'context/README.md'])
      for (const line of read(file).split(/\r?\n/)) {
        if (!/chega com a #\d+/i.test(line)) continue
        for (const span of spansOf(line)) {
          if (!/^[\w./-]+$/.test(span) || !span.includes('/')) continue
          const candidates = [span, `context/${span}`]
          for (const candidate of candidates)
            expect(
              existsSync(path.join(root, candidate)),
              `${file}: ${line}`,
            ).toBe(false)
        }
      }
  })
})

describe('docs against the audit’s and the refresh’s contract values', () => {
  const judge = `passo \`${auditJudgeStep}\``
  const verdict = `passo \`${auditVerdictStep}\``

  it('main-audit.yml runs the judging step, then the verdict step, by the names in loop-sections', () => {
    const names = [...read(mainAudit).matchAll(/^ {6}- name: (.+?)[ \t]*$/gm)]
      .map((match) => match[1])
      .filter((name) => [auditJudgeStep, auditVerdictStep].includes(name))
    expect(names).toEqual([auditJudgeStep, auditVerdictStep])
  })

  it.each([workflowGuide, adr0002])(
    '%s names both steps and counts as audited only a run whose judging step finished',
    (file) => {
      const text = read(file)
      expect(text).toContain(judge)
      expect(text).toContain(verdict)
      expect(text).toContain(
        `só conta como auditada a run cujo ${judge} terminou`,
      )
    },
  )

  it('main-audit.yml runs on the schedule loop-sections gives, and the docs state it', () => {
    const cron = /^\s*- cron: '([^']+)'\s*$/m.exec(read(mainAudit))?.[1]
    expect(cron).toBe(auditCron)
    for (const file of [workflowGuide, adr0002])
      expect(read(file), file).toContain(`cron \`${auditCron}\``)
  })

  it('ADR 0002 lists exactly the permissions main-audit.yml grants', () => {
    // Split at periods only: each permission holds a colon.
    const sentence = read(adr0002)
      .split(/(?<=\.)\s+/)
      .find((text) => text.startsWith('As permissões são'))
    expect(sentence).toBeDefined()
    const stated = Object.fromEntries(
      spansOf(sentence ?? '')
        .map((span) => /^([\w-]+): (\w+)$/.exec(span))
        .filter((entry): entry is RegExpExecArray => entry !== null)
        .map(([, key, value]) => [key, value]),
    )
    expect(stated).toEqual(topMap(read(mainAudit), 'permissions'))
  })

  it.each([workflowGuide, adr0002])(
    '%s states the link-lag retries, their wait, the issue cap and the runs read',
    (file) => {
      const text = bodyOf(read(file))
      expect(text).toContain(`até ${auditLinkRetries} vezes`)
      const tries = numbersIn(text, /depois das (\d+) tentativas/g)
      expect(tries.length, file).toBeGreaterThan(0)
      for (const count of tries) expect(count, file).toBe(auditLinkRetries)
      const waits = numbersIn(
        text,
        /(\d+) s (?:por padrão|antes de cada tentativa|entre as tentativas)/g,
      )
      expect(waits.length, file).toBeGreaterThan(0)
      for (const seconds of waits)
        expect(seconds, file).toBe(auditRetryDelayMs / 1000)
      const caps = numbersIn(text, /mais de (\d+) commits fora do loop/g)
      expect(caps.length, file).toBeGreaterThan(0)
      for (const cap of caps) expect(cap, file).toBe(auditIssueCap)
      expect(text).toContain(
        `as ${auditRunsRead} runs concluídas mais recentes`,
      )
    },
  )

  it.each([workflowGuide, adr0002, loopGate])(
    '%s states how often and how long the refresh waits for a run in progress',
    (file) => {
      const text = bodyOf(read(file))
      const polls = numbersIn(text, /a cada (\d+) s\b/g)
      expect(polls.length, file).toBeGreaterThan(0)
      for (const poll of polls) expect(poll, file).toBe(refreshPollMs / 1000)
      const minutes = numbersIn(text, /até (\d+) minutos/g)
      expect(minutes.length, file).toBeGreaterThan(0)
      for (const wait of minutes)
        expect(wait, file).toBe(refreshWaitMs / 60_000)
    },
  )

  it.each([workflowGuide, adr0002])(
    '%s accepts the issue-link only from its pull_request_target run of issue-link.yml',
    (file) => {
      const stated = sentencesOf(read(file)).filter(
        (sentence) =>
          sentence.includes('`issue-link` só conta') &&
          sentence.includes(`\`${issueLinkEvent}\``) &&
          sentence.includes(`\`${issueLinkWorkflowPath}\``),
      )
      expect(stated, file).not.toEqual([])
    },
  )

  it.each([workflowGuide, adr0002, loopGate])(
    '%s has the refresh re-run only the issue-link’s pull_request_target run',
    (file) => {
      const stated = sentencesOf(read(file)).filter(
        (sentence) =>
          /re-executa (?:a run mais recente do|o) `issue-link`/.test(
            sentence,
          ) && sentence.includes(`\`${issueLinkEvent}\``),
      )
      expect(stated, file).not.toEqual([])
    },
  )

  it.each([workflowGuide, adr0002])(
    '%s quotes the rewrite reason as the audit writes it',
    (file) => {
      const reason = 'histórico de main reescrito desde a última auditoria'
      expect(read('scripts/audit-main.mjs')).toContain(`${reason} (`)
      expect(read(file)).toContain(`\`${reason} (execução <id>, em <sha7>)\``)
    },
  )

  it.each([workflowGuide, adr0002])(
    '%s states the page the audit reads closing references and head checks with',
    (file) => {
      const text = bodyOf(read(file))
      const closing = numbersIn(
        text,
        /mais de (\d+) referências de fechamento/g,
      )
      expect(closing.length, file).toBeGreaterThan(0)
      for (const size of closing) expect(size, file).toBe(auditClosingPage)
      const checks = numbersIn(text, /mais de (\d+) check (?:suites|runs)/g)
      expect(checks.length, file).toBeGreaterThan(0)
      for (const size of checks) expect(size, file).toBe(auditChecksPage)
    },
  )

  it.each([workflowGuide, adr0002])(
    '%s quotes the incomplete-page reason as the audit writes it',
    (file) => {
      const reason = 'referências de fechamento, não lidas todas'
      expect(read('scripts/audit-main.mjs')).toContain(
        `: mais de \${auditClosingPage} ${reason}`,
      )
      expect(read(file)).toContain(
        `\`PR #P: mais de ${auditClosingPage} ${reason}`,
      )
    },
  )

  it('the doc links in the audit’s and the refresh’s own text reach a heading that exists', () => {
    // The audit issue body links to the workflow guide and to ADR 0002 on
    // GitHub; a renamed heading would 404 in every issue it opens.
    const links = ['scripts/audit-main.mjs', 'scripts/refresh-issue-link.mjs']
      .flatMap((script) => [
        ...read(script).matchAll(
          /\b((?:docs|context)\/[\w./-]+\.md)(?:#([\p{L}\p{N}_-]+))?/gu,
        ),
      ])
      .map(([, file, anchor]) => ({ file, anchor }))
    expect(
      links.filter(({ anchor }) => anchor !== undefined).length,
    ).toBeGreaterThan(0)
    for (const { file, anchor } of links) {
      expect(existsSync(path.join(root, file)), file).toBe(true)
      if (anchor !== undefined)
        expect(anchorsOf(read(file)).has(anchor), `${file}#${anchor}`).toBe(
          true,
        )
    }
  })

  it('the audit issue body links to the guide’s merge rules and to ADR 0002', () => {
    const script = read('scripts/audit-main.mjs')
    expect(script).toContain(
      '/blob/main/docs/development/workflow.md#pull-requests-e-merge',
    )
    expect(script).toContain(`/blob/main/${adr0002}`)
  })
})

describe('docs against the gate’s own rules (#12)', () => {
  const gate = read('scripts/gate.mjs')
  const lineOf = (file: string, start: string): string =>
    read(file)
      .split(/\r?\n/)
      .find((line) => line.startsWith(start)) ?? ''

  it('the loop-gate pattern exempts from stacked exactly the refs the gate exempts', () => {
    expect(gate).toContain('`refs/heads/${branch}`')
    expect(gate).toContain('`refs/remotes/origin/${branch}`')
    const stated = lineOf(loopGate, '- **Ref estranha**')
    expect(stated).toContain('`refs/heads/<branch>`')
    expect(stated).toContain('`refs/remotes/origin/<branch>`')
    expect(stated).not.toContain('mesma issue')
    expect(lineOf(loopGate, '- **Outra branch da mesma issue.**')).toContain(
      'Nenhuma das duas isenções vale',
    )
  })

  it.each([loopGate, lifecycle])(
    '%s gives the remedies the gate prints for another branch of the issue',
    (file) => {
      for (const command of [
        'git branch -d',
        'git push origin --delete',
        'git fetch --prune origin',
      ]) {
        expect(gate).toContain(command)
        expect(read(file), file).toContain(command)
      }
      expect(gate).toContain('tem commits que esta não tem')
    },
  )

  it('the loop-gate pattern states the label page the gate reads', () => {
    const page = Number(/^const page = (\d+)$/m.exec(gate)?.[1])
    expect(gate).toContain('labels(first: ${page})')
    const stated = lineOf(loopGate, '- **O limite de leitura.**')
    expect(numbersIn(stated, /mais de (\d+) labels/g)).toEqual([page])
    expect(stated).toContain('`kind` e `state-label` bloqueiam')
  })

  it.each([loopGate, workflowGuide])(
    '%s says a heading or a box inside code or an HTML comment does not count',
    (file) => {
      const stated = read(file)
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.includes('comentário HTML') &&
            line.includes('não abre seção') &&
            /não (?:conta|é critério)/.test(line),
        )
      expect(stated, file).not.toEqual([])
    },
  )

  it.each([loopGate, workflowGuide])(
    '%s counts a reopening and another actor’s later ready-for-agent among the acts that cancel the Approve',
    (file) => {
      const stated = read(file)
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.includes('cancelam o Approve venha de quem vier') &&
            line.includes('uma reabertura') &&
            line.includes('`ready-for-agent` por outro ator'),
        )
      expect(stated, file).not.toEqual([])
    },
  )

  // The gate (label-not-owner, before-reopen) counts the last application
  // only, and it must be the owner's, after the last reopening and after the
  // Approve in force (#12).
  it.each([workflowGuide, 'context/README.md'])(
    '%s states the label rule the gate applies',
    (file) => {
      const rule = lineOf(file, '- **A label vem depois do Approve.**')
      expect(rule, file).toContain(
        '`ready-for-agent` só conta se a última aplicação dela foi do dono, depois da última reabertura e depois do Approve em vigor',
      )
    },
  )

  // hasContent and planCitesBranch read a section as GitHub shows it: a
  // comment is not there, fenced code is (#12).
  it.each([loopGate, workflowGuide])(
    '%s says section content and the branch citation ignore HTML comments, and fenced code counts',
    (file) => {
      const stated = read(file)
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.includes('`<!-- HIGH ou NORMAL -->`') &&
            line.includes('está vazia') &&
            line.includes('citada só dentro de um comentário não conta') &&
            line.includes('Um bloco de código é texto visível'),
        )
      expect(stated, file).not.toEqual([])
    },
  )

  // hiddenLines reads a fence under a list item at any indentation (#12).
  it.each([loopGate, workflowGuide])(
    '%s says a box in a code block nested in a list item does not count, and states the indented-code limit',
    (file) => {
      const stated = read(file)
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.includes('item de lista') &&
            line.includes('quatro espaços ou mais') &&
            /caixa ne(?:le|sse bloco) não conta/.test(line) &&
            line.includes('uma caixa nele ainda conta'),
        )
      expect(stated, file).not.toEqual([])
    },
  )

  it.each([loopGate, lifecycle])(
    '%s says the delete remedy names only the commands for the refs found',
    (file) => {
      expect(read(file), file).toMatch(
        /cita só os comandos das (?:refs|cópias)/,
      )
    },
  )
})

describe('docs against the skip tokens', () => {
  /** A span that reads like a token that skips a run: `[skip ci]`, `[no ci]` … */
  const skipLike = /^\[(?:skip|ci|no|actions)\b[^\]]*\]$/i

  it.each([workflowGuide, lifecycle, adr0002, 'AGENTS.md'])(
    '%s lists exactly the skip tokens, in order, wherever it lists them',
    (file) => {
      const lists = read(file)
        .split(/\r?\n/)
        .filter((line) => line.includes(`\`${skipCiTokens[1]}\``))
      expect(lists.length, file).toBeGreaterThan(0)
      for (const line of lists)
        expect(
          spansOf(line).filter((span) => skipLike.test(span)),
          line,
        ).toEqual([...skipCiTokens])
      for (const span of spansOf(read(file)).filter((text) =>
        skipLike.test(text),
      ))
        expect(skipCiTokens, `${file}: ${span}`).toContain(span)
    },
  )

  it.each([workflowGuide, lifecycle, adr0002, 'AGENTS.md'])(
    '%s also forbids the skip-checks trailer',
    (file) => {
      expect(read(file)).toContain(`\`${skipChecksTrailer}\``)
    },
  )

  it('the PR rules forbid the tokens in the title, the body and every commit message', () => {
    const rule = sectionOf(read(workflowGuide), '## Pull requests e merge')
      .split(/\r?\n/)
      .find((line) => line.startsWith('- **Nenhum token de pular CI.**'))
    expect(rule).toBeDefined()
    expect(rule).toMatch(
      /Nem o título da PR, nem o corpo da PR, nem mensagem de commit nenhuma/,
    )
    expect(rule).toContain('`PR_TITLE` e `PR_BODY`')
  })

  it('no doc promises a verdict to every commit of main', () => {
    // Only a push that starts a run gets one; what a push without a run
    // brought is left to the next audit.
    for (const file of [
      workflowGuide,
      adr0002,
      lifecycle,
      loopGate,
      'AGENTS.md',
    ]) {
      const text = read(file)
      expect(text, file).not.toMatch(/todo commit de `main` ganha um veredito/)
    }
    for (const file of [workflowGuide, adr0002])
      expect(read(file), file).toContain(
        'todo push em `main` que dispara run ganha um veredito; o que um push sem run trouxe entra na auditoria seguinte',
      )
  })
})

// The docs write a command with placeholders (`<n>`, `<branch>`), which the
// builders would quote (shellWord), so the builders run on sample values that
// need no quoting and the placeholders are put back in their place.
const SAMPLE_PR = 424242
const SAMPLE_BRANCH = 'feature/1-sample-branch'
const asDocs = (command: string, pr: string, branch = '<branch>') =>
  command.replace(SAMPLE_BRANCH, branch).replace(String(SAMPLE_PR), pr)

describe('docs against the review gate’s contract values (#13)', () => {
  const gate = read('scripts/gate.mjs')
  const refresh = `.github/workflows/${issueLinkRefreshWorkflowFile}`
  const reviewSteps = ['copilot-review', 'review-threads']

  /** Code spans as pt-BR prose lists them: `a`, `b` ou `c`. */
  const orList = (items: readonly string[]): string => {
    const spans = items.map((item) => `\`${item}\``)
    return spans.length < 2
      ? spans.join('')
      : `${spans.slice(0, -1).join(', ')} ou ${spans[spans.length - 1]}`
  }

  it.each([adr0003, loopGate])(
    '%s identifies Copilot by type and database id, as copilotReviewer does',
    (file) => {
      const text = bodyOf(read(file))
      expect(text).toContain(`\`${copilotReviewer.typename}\``)
      const ids = numbersIn(text, /`databaseId` (\d+)/g)
      expect(ids.length, file).toBeGreaterThan(0)
      for (const id of ids) expect(id, file).toBe(copilotReviewer.databaseId)
    },
  )

  it.each([adr0003, loopGate])(
    '%s spells the bot’s logins only as the contract does',
    (file) => {
      const text = read(file)
      expect(text).toContain(`\`${copilotReviewer.login}\``)
      const logins = spansOf(text).filter((span) =>
        span.startsWith('copilot-pull-request-reviewer'),
      )
      for (const login of logins)
        expect([copilotReviewer.login, copilotRequestLogin], file).toContain(
          login,
        )
    },
  )

  it('ADR 0003 names the login that requests a review', () => {
    expect(read(adr0003)).toContain(
      `o login de pedido (\`${copilotRequestLogin}\`)`,
    )
  })

  it.each([adr0003, loopGate, workflowGuide])(
    '%s lists the review states that count exactly as copilotReviewStates',
    (file) => {
      // Every list of two or more states that holds COMMENTED is the list of
      // the states that count, whole: not a prefix of it, not a longer one.
      const lists = [
        ...read(file).matchAll(/`[A-Z_]+`(?:(?:, | ou | e )`[A-Z_]+`)+/g),
      ]
        .map((match) => match[0])
        .filter((list) => list.includes('`COMMENTED`'))
      expect(lists.length, file).toBeGreaterThan(0)
      for (const list of lists)
        expect(list, file).toBe(orList(copilotReviewStates))
    },
  )

  it.each([adr0003, loopGate])(
    '%s names as not counting only states copilotReviewStates leaves out',
    (file) => {
      // A sentence that says DISMISSED does not count names no counting state.
      const denials = sentencesOf(read(file)).filter((sentence) =>
        sentence.includes('`DISMISSED`'),
      )
      expect(denials.length, file).toBeGreaterThan(0)
      for (const sentence of denials) {
        expect(sentence, file).toMatch(/não/)
        for (const state of spansOf(sentence).filter((span) =>
          /^[A-Z_]+$/.test(span),
        ))
          expect(copilotReviewStates, sentence).not.toContain(state)
      }
    },
  )

  it.each([adr0003, adr0002, workflowGuide])(
    '%s states the instant the audit holds merges to the review rule from',
    (file) => {
      expect(read('scripts/audit-main.mjs')).toContain('reviewRuleSince')
      const named = [
        ...bodyOf(read(file)).matchAll(/`([^`]+)` \(`reviewRuleSince`\)/g),
      ].map((match) => match[1])
      expect(named.length, file).toBeGreaterThan(0)
      for (const instant of named) expect(instant, file).toBe(reviewRuleSince)
    },
  )

  it.each([adr0003, loopGate, workflowGuide, lifecycle, 'AGENTS.md'])(
    '%s gives the command that requests a Copilot review as the gate prints it',
    (file) => {
      expect(gate).toContain('copilotRequestCommand(options.pr)')
      const text = read(file)
      expect(text).toContain(
        `\`${asDocs(copilotRequestCommand(SAMPLE_PR), '<n>')}\``,
      )
      const handles = [...text.matchAll(/--add-reviewer ([^\s`]+)/g)].map(
        (match) => match[1],
      )
      for (const handle of handles) expect(handle, file).toBe(copilotHandle)
    },
  )

  // AGENTS.md left the list with #30: after resolving a thread the check
  // needs no refresh, since the issue-link only reports the threads.
  it.each([adr0003, adr0002, loopGate, workflowGuide, lifecycle])(
    '%s gives the command that brings one PR’s check up to date through the refresh’s dispatch, on main',
    (file) => {
      expect(read('scripts/refresh-issue-link.mjs')).toContain(
        'refreshPrCommand(input.pr)',
      )
      const input = /^ {2}workflow_dispatch:\n {4}inputs:\n {6}([\w-]+):/m.exec(
        read(refresh),
      )?.[1]
      expect(input).toBeDefined()
      expect(refreshPrCommand(SAMPLE_PR)).toContain(` -f ${input}=${SAMPLE_PR}`)
      const text = read(file)
      expect(text).toContain(
        `\`${asDocs(refreshPrCommand(SAMPLE_PR), '<n>')}\``,
      )
      const runs = [
        ...text.matchAll(
          /gh workflow run (issue-link-refresh[\w.-]*)([^`\n]*)/g,
        ),
      ]
      expect(runs.length, file).toBeGreaterThan(0)
      for (const [, workflow, rest] of runs) {
        expect(workflow, file).toBe(issueLinkRefreshWorkflowFile)
        expect(rest, file).toContain(` -f ${input}=`)
        // A dispatch runs the YAML and the script of the ref it names.
        expect(rest, file).toContain(' --ref main ')
      }
    },
  )

  it('the workflow guide’s review-step table names the review steps, in the gate’s order', () => {
    const tables = tablesOf(
      sectionOf(read(workflowGuide), '## A revisão do Copilot e as threads'),
    ).filter(([header]) => header[0] === 'Passo')
    expect(tables).toHaveLength(1)
    const ids = tables[0]
      .slice(1)
      .map(([cell]) => /^`([\w-]+)`$/.exec(cell)?.[1] ?? cell)
    for (const id of ids) expect(stepIds).toContain(id)
    expect(ids).toEqual(stepIds.filter((id) => ids.includes(id)))
    expect(ids).toEqual(expect.arrayContaining(reviewSteps))
  })

  it('the loop-gate pattern says the review steps block in CI outside a draft, as the gate does', () => {
    expect(gate).toContain('const reviewBlocks = pr.isDraft !== true')
    const table = tablesOf(read(loopGate)).find(
      ([header]) => header[0] === 'Passo',
    )
    for (const id of reviewSteps) {
      const row = (table ?? []).find(([cell]) => cell === `\`${id}\``)
      expect(row?.[2], id).toBe('No CI, fora de draft')
    }
  })

  it('the loop-gate pattern states how many open threads the gate names', () => {
    const shown = Number(/^const threadsShown = (\d+)$/m.exec(gate)?.[1])
    expect(gate).toContain('open.slice(0, threadsShown)')
    const stated = numbersIn(read(loopGate), /[Ll]ista até (\d+)/g)
    expect(stated.length).toBeGreaterThan(0)
    for (const count of stated) expect(count).toBe(shown)
  })

  it.each([workflowGuide, adr0002])(
    '%s quotes the audit’s review reasons as the audit writes them, and the page it reads',
    (file) => {
      const audit = read('scripts/audit-main.mjs')
      expect(audit).toContain(
        '`PR #${number} mergeada sem revisão do Copilot na cabeça ${short(headRefOid)}`',
      )
      expect(audit).toContain(
        '`PR #${number} mergeada com ${open.length} thread(s) de revisão aberta(s)`',
      )
      const text = read(file)
      expect(text).toContain(
        '`PR #P mergeada sem revisão do Copilot na cabeça <sha7>`',
      )
      expect(text).toContain(
        '`PR #P mergeada com <n> thread(s) de revisão aberta(s)`',
      )
      const pages = numbersIn(
        bodyOf(text),
        /mais de (\d+) (?:revisões|threads de revisão)/g,
      )
      expect(pages.length, file).toBeGreaterThan(0)
      for (const size of pages) expect(size, file).toBe(auditReviewPage)
    },
  )

  it('the decision index attributes to #4 only decisions that exist', () => {
    // Before #4 the index promised its retroactive decisions numbers no file
    // held yet; #4 wrote them, so every number it names now has its file.
    const held = readdirSync(path.join(root, 'context', 'decisions'))
      .map((file) => /^(\d{4})-/.exec(file)?.[1])
      .filter((number): number is string => number !== undefined)
      .map(Number)
    expect(held).toContain(3)
    const attributed = sentencesOf(read('context/decisions/README.md'))
      .filter(
        (sentence) => sentence.includes('#4') && /retroativ/.test(sentence),
      )
      .flatMap((sentence) => numbersIn(sentence, /\b(\d{4})\b/g))
    expect(attributed.length).toBeGreaterThan(0)
    for (const number of attributed) expect(held).toContain(number)
  })

  it('ADR 0003 quotes the owner’s request as the intent records it', () => {
    const quote = /\*\*"([^"]+)"\*\*/.exec(
      read('context/intent/feature-review-gate.md'),
    )?.[1]
    expect(quote).toBeDefined()
    expect(read(adr0003)).toContain(`**"${quote}"**`)
  })

  it.each([workflowGuide, lifecycle, 'AGENTS.md'])(
    '%s states the merge rule: a Copilot review on the head and no open thread of any author, outdated ones included',
    (file) => {
      const stated = bodyOf(read(file))
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.toLowerCase().includes('revisão do copilot na cabeça') &&
            line.includes('nenhuma thread') &&
            line.includes('de qualquer autor') &&
            line.includes('inclusive as desatualizadas'),
        )
      expect(stated, file).not.toEqual([])
    },
  )

  it.each([adr0003, workflowGuide, 'AGENTS.md'])(
    '%s says there is no bypass',
    (file) => {
      expect(read(file)).toMatch(/Não há bypass/)
    },
  )
})

describe('docs against the review gate after the #13 reviews', () => {
  const gate = read('scripts/gate.mjs')
  const freshVerdictDocs = [
    workflowGuide,
    'AGENTS.md',
    lifecycle,
    adr0002,
    adr0003,
  ]
  const notFresh = /não é (?:um )?veredito fresco/

  /** A doc's prose, fenced code left out, as sentences split after . ! or ? */
  const proseOf = (text: string): string[] =>
    text
      .replace(/^```[^\n]*\n[\s\S]*?^```$/gm, '')
      .split(/\r?\n/)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/))

  /** The lines of a doc's fenced code blocks, block by block. */
  const fencesOf = (text: string): string[][] =>
    [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)].map((match) =>
      match[1].split(/\r?\n/),
    )

  it.each([...freshVerdictDocs, loopGate])(
    '%s calls a refresh dispatch no fresh verdict wherever it gives one',
    (file) => {
      const text = bodyOf(read(file))
      for (const sentence of proseOf(text).filter((line) =>
        line.includes('gh workflow run issue-link-refresh'),
      ))
        expect(sentence, file).toMatch(notFresh)
      for (const lines of fencesOf(text))
        lines.forEach((line, index) => {
          if (line.startsWith('gh workflow run issue-link-refresh'))
            expect(lines[index - 1] ?? '', file).toMatch(
              new RegExp(`^# .*${notFresh.source}`),
            )
        })
    },
  )

  it.each([...freshVerdictDocs, loopGate])(
    '%s never offers the refresh as a way to renew the verdict',
    (file) => {
      for (const sentence of proseOf(bodyOf(read(file))).filter(
        (line) =>
          /renov/i.test(line) &&
          /veredito/i.test(line) &&
          /refresh/i.test(line),
      ))
        expect(sentence, file).toMatch(notFresh)
    },
  )

  it.each(freshVerdictDocs)(
    '%s gives the fresh verdict, the gate in CI mode, and says a re-run of the issue-link is none (#30)',
    (file) => {
      expect(gate).toContain('gateCiCommand(options.pr, options.branch)')
      const text = bodyOf(read(file))
      const gateRuns = [
        ...text.matchAll(
          /node scripts\/gate\.mjs --pr (<\w+>) --branch (<\w+>)/g,
        ),
      ]
      expect(gateRuns.length, file).toBeGreaterThan(0)
      for (const [command, pr, branch] of gateRuns)
        expect(command, file).toBe(
          asDocs(gateCiCommand(SAMPLE_PR, SAMPLE_BRANCH), pr, branch),
        )
      // Since #30 the issue-link runs with --review-report: re-running it
      // judges neither the Copilot review nor the threads.
      expect(text, file).not.toMatch(
        /gh run watch <run-id>(?: --repo \S+)? --exit-status/,
      )
      const reruns = proseOf(text).filter((sentence) =>
        /rerun do (?:job )?`issue-link`/.test(sentence),
      )
      expect(
        reruns.some((sentence) => notFresh.test(sentence)),
        file,
      ).toBe(true)
    },
  )

  it.each(freshVerdictDocs)(
    '%s never gives the fresh verdict with --review-report, the option of the issue-link workflow (#30)',
    (file) => {
      expect(gateCiCommand(SAMPLE_PR, SAMPLE_BRANCH)).not.toContain(
        '--review-report',
      )
      expect(bodyOf(read(file)), file).not.toMatch(
        /node scripts\/gate\.mjs --pr <\w+> --branch <\w+> --review-report/,
      )
    },
  )

  it.each([adr0002, adr0003, workflowGuide])(
    '%s says a dispatch runs the copy of the ref it was dispatched on',
    (file) => {
      expect(read(file)).toContain(
        'roda o YAML e o script da ref em que foi disparado',
      )
    },
  )

  it.each([loopGate, adr0003, workflowGuide])(
    '%s states the review page the gate reads, the newest, as the gate reads it',
    (file) => {
      const page = Number(/^const page = (\d+)$/m.exec(gate)?.[1])
      expect(gate).toContain('reviews(last: ${page})')
      // The guide also counts the audit's newest runs, elsewhere.
      const text =
        file === workflowGuide
          ? sectionOf(read(file), '## A revisão do Copilot e as threads')
          : read(file)
      const stated = numbersIn(text, /(\d+) (?:revisões )?mais recentes/g)
      expect(stated.length, file).toBeGreaterThan(0)
      for (const size of stated) expect(size, file).toBe(page)
    },
  )

  it('the loop-gate step table says a counting review among the newest page is enough', () => {
    const table = tablesOf(bodyOf(read(loopGate))).find(
      ([header]) => header[0] === 'Passo',
    )
    const rule = (table ?? []).find(
      ([cell]) => cell === '`copilot-review`',
    )?.[1]
    expect(rule).toMatch(/mais recentes basta/)
    expect(rule).not.toMatch(/página lida pela metade/)
  })

  it.each([loopGate, adr0003])(
    '%s says a counting review among the newest page is enough',
    (file) => {
      // Not the Status block: an Atualizado line records what changed then.
      const enough = proseOf(bodyOf(read(file))).filter(
        (sentence) =>
          sentence.includes('mais recentes') && /\bbasta\b/.test(sentence),
      )
      expect(enough, file).not.toEqual([])
    },
  )

  it.each([adr0003, loopGate, adr0002])(
    '%s names the contract that tells a failed review',
    (file) => {
      expect(read(file)).toContain('`copilotFailedReview`')
    },
  )

  it.each([adr0003, loopGate, workflowGuide])(
    '%s quotes only failure texts copilotFailedReview matches',
    (file) => {
      const quoted = [...read(file).matchAll(/"(Copilot [^"]+)"/g)].map(
        (match) => match[1],
      )
      expect(quoted.length, file).toBeGreaterThan(1)
      for (const body of quoted)
        expect(copilotFailedReview.test(body), body).toBe(true)
    },
  )

  it.each([
    adr0002,
    adr0003,
    workflowGuide,
    'AGENTS.md',
    lifecycle,
    loopGate,
    'context/knowledge/patterns/review-before-merge.md',
  ])(
    '%s neither calls the refresh unproven nor keeps the review signal, gone since #30',
    (file) => {
      for (const sentence of proseOf(bodyOf(read(file)))) {
        expect(sentence, file).not.toMatch(/não foi provad[oa] ao vivo/)
        if (/[Ss]inal de revisão|review-signal/.test(sentence))
          expect(sentence, file).toContain('#30')
      }
    },
  )

  it.each([workflowGuide, lifecycle, 'AGENTS.md', adr0003])(
    '%s makes the re-request checkable on the PR timeline, without assuming the owner’s setting',
    (file) => {
      const text = read(file)
      expect(text, file).toMatch(
        /gh api (?:--paginate )?repos\/geazioliveira\/marketo-sandbox\/issues\/<[pn]>\/timeline/,
      )
      expect(text, file).toContain('`review_requested`')
      expect(text, file).toMatch(/uns 10 min/)
      expect(text, file).toContain(
        `\`${asDocs(copilotRequestCommand(SAMPLE_PR), '<n>')}\``,
      )
      expect(text, file).not.toMatch(
        /(?:[Ee]nquanto|[Cc]om) "Review new pushes" (?:não )?(?:estiver )?ligad/,
      )
    },
  )

  it('the workflow guide’s timeline filter matches Copilot by type and database id', () => {
    const filter =
      /select\(\.event == "review_requested" and \.requested_reviewer\.type == "(\w+)" and \.requested_reviewer\.id == (\d+)\)/.exec(
        read(workflowGuide),
      )
    expect(filter?.[1]).toBe(copilotReviewer.typename)
    expect(Number(filter?.[2])).toBe(copilotReviewer.databaseId)
  })

  describe('the hooks of #5, as they are', () => {
    const markdownUnder = (dir: string): string[] =>
      readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
        (entry) => {
          const relative = `${dir}/${entry.name}`
          if (entry.isDirectory()) return markdownUnder(relative)
          return entry.name.endsWith('.md') ? [relative] : []
        },
      )
    // An intent records the plan as the owner approved it, and evolution/ and
    // each Status block record what was true when they were written: none is
    // restated after the fact, so they are left out.
    const docs = [...markdownUnder('docs'), ...markdownUnder('context')].filter(
      (file) =>
        !file.startsWith('context/intent/') &&
        !file.startsWith('context/evolution/'),
    )
    const withoutStatus = (text: string) => text.split(/\n## Status\n/)[0]
    // The hooks exist since #5: a sentence that still promises them is stale.
    const future =
      /(?<!\p{L})(?:vão|vai|irão|irá|chegarem|existirem|ainda não existem?)(?!\p{L})/iu

    it('are found in the docs at all', () => {
      expect(docs.some((file) => read(file).includes('hooks da #5'))).toBe(true)
    })

    it.each(docs)(
      '%s names the hooks of #5 as they are, never as to come',
      (file) => {
        const sentences = withoutStatus(read(file))
          .split(/\r?\n/)
          .flatMap((line) => line.split(/(?<=[.!?;])\s+/))
          .filter((sentence) => sentence.includes('hooks da #5'))
        for (const sentence of sentences)
          expect(sentence, file).not.toMatch(future)
      },
    )

    /** A script's comments, block by block, as sentences. */
    const commentSentences = (source: string): string[] => {
      const blocks: string[] = []
      let block: string[] = []
      for (const line of source.split(/\r?\n/)) {
        const comment =
          /^\s*(?:\/\/|\/\*\*?|\*(?!\/))\s?(.*?)\s*(?:\*\/)?$/.exec(line)
        if (comment === null) {
          if (block.length > 0) blocks.push(block.join(' '))
          block = []
        } else block.push(comment[1])
      }
      if (block.length > 0) blocks.push(block.join(' '))
      return blocks.flatMap((text) => text.split(/(?<=[.!?;])\s+/))
    }

    const scripts = readdirSync(path.join(root, 'scripts'))
      .filter((file) => file.endsWith('.mjs'))
      .map((file) => `scripts/${file}`)

    it('are named in the scripts’ comments at all', () => {
      expect(
        scripts.some((file) =>
          commentSentences(read(file)).some((sentence) =>
            /hooks? (?:of #5|\(#5\))/.test(sentence),
          ),
        ),
      ).toBe(true)
    })

    it.each(scripts)(
      '%s names the hooks of #5 in its comments as they are, never as to come',
      (file) => {
        for (const sentence of commentSentences(read(file)).filter((text) =>
          /hooks? (?:of #5|\(#5\))/.test(text),
        ))
          expect(sentence, file).not.toMatch(
            /\b(?:will|are to|is to|do not exist yet|once they exist)\b/i,
          )
      },
    )

    it('the workflow names each hook that exists in .claude/hooks, and no other', () => {
      const guide = read('docs/development/workflow.md')
      const [, section = ''] = guide.split('\n## Os hooks do Claude Code\n')
      const named = [
        ...section.split('\n## ')[0].matchAll(/^\| `([a-z-]+)` \|/gm),
      ].map((match) => match[1])
      const present = readdirSync(path.join(root, '.claude', 'hooks'))
        .filter((file) => file.endsWith('.mjs'))
        .map((file) => file.replace(/\.mjs$/, ''))
      expect(named.length).toBeGreaterThan(0)
      expect([...named].sort()).toEqual([...present].sort())
    })
  })
})
