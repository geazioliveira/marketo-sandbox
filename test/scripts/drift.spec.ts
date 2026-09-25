import { existsSync, readFileSync } from 'node:fs'
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
  auditRunsRead,
  auditTitlePrefix,
  auditVerdictStep,
  branchCategory,
  branchPrefixes,
  bugSections,
  commentOpening,
  featureSections,
  issueLinkEvent,
  issueLinkWorkflowPath,
  planHeading,
  refreshPollMs,
  refreshWaitMs,
  requiredChecks,
  skipCiTokens,
  skipChecksTrailer,
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
const adr0001 = 'context/decisions/0001-context-mesh-in-the-repository.md'
const adr0002 = 'context/decisions/0002-soft-enforcement-on-github-free.md'
const mainAudit = '.github/workflows/main-audit.yml'

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

  it.each([workflowGuide, adr0002])(
    '%s points the e2e telemetry where check.yml does',
    (file) => {
      const endpoint = /^\s*OBSERVE_ENDPOINT:\s*(\S+)\s*$/m.exec(
        read('.github/workflows/check.yml'),
      )?.[1]
      expect(endpoint).toBe('http://127.0.0.1:9')
      expect(read(file)).toContain(`OBSERVE_ENDPOINT=${endpoint}`)
    },
  )

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
