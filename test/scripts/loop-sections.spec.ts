import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as loop from '../../scripts/loop-sections.mjs'
import {
  approveLikeHeading,
  approveState,
  branchCategory,
  branchPrefixes,
  branchSectionFor,
  branchShapes,
  bugSections,
  categoryLabels,
  changelogHeadingFor,
  checkSections,
  commentOpening,
  copilotFailedReview,
  copilotHandle,
  copilotRequestCommand,
  copilotRequestLogin,
  copilotRequested,
  copilotReviewer,
  copilotReviewOn,
  copilotReviewStates,
  countCriteria,
  criteriaSection,
  currentPlan,
  featureSections,
  findSection,
  foldHeading,
  gateCacheSchema,
  gateCiCommand,
  gateStatus,
  gateTtlHours,
  hasContent,
  headAndRest,
  isCopilotReviewer,
  issueFromBranch,
  kindOf,
  matchesHeading,
  openThreads,
  parseBranch,
  parseSections,
  planCitesBranch,
  refreshPrCommand,
  reviewRuleSince,
  shellWord,
  sectionsFor,
  stepIds,
  type GateCache,
  type IssueComment,
  type PullRequestReview,
  type ReviewThread,
  type TimelineEvent,
} from '../../scripts/loop-sections.mjs'

/**
 * The loop's contracts, one function at a time. The gate spec drives them
 * end to end through a fake GitHub; these pin each rule where it lives, so a
 * failure names the rule rather than a scenario.
 */

const root = path.resolve(__dirname, '..', '..')

describe('parseBranch', () => {
  it.each([
    [
      'feature/2-loop-minimo',
      { prefix: 'feature', issue: 2, slug: 'loop-minimo' },
    ],
    ['fix/10-a', { prefix: 'fix', issue: 10, slug: 'a' }],
    ['feature/123-a1-b2', { prefix: 'feature', issue: 123, slug: 'a1-b2' }],
  ])('accepts %s', (branch, parsed) => {
    expect(parseBranch(branch)).toEqual(parsed)
  })

  it.each([
    'feature/02-x',
    'feature/0-x',
    'feature/1--x',
    'feature/1-x-',
    'feature/1-',
    'feature/1',
    'feature/1-X',
    'feature/1-a_b',
    'feature/1-a/b',
    'feature/x-1',
    'feature/1-x.old',
    'feature/1-x.',
    'feature/1.2-x',
    'feature/1-a.b-c',
    'claude/x',
    'claude/2-x',
    'batch/2026-09-22',
    'chore/1-x',
    'main',
    '',
  ])('refuses %j', (branch) => {
    expect(parseBranch(branch)).toBeNull()
  })

  it('refuses null and undefined', () => {
    expect(parseBranch(null)).toBeNull()
    expect(parseBranch(undefined)).toBeNull()
  })

  it('gives the issue a branch names, or null', () => {
    expect(issueFromBranch('fix/7-a')).toBe(7)
    expect(issueFromBranch('claude/x')).toBeNull()
  })

  it('names every accepted prefix in the shapes it prints', () => {
    for (const prefix of branchPrefixes)
      expect(branchShapes).toContain(`${prefix}/<número>-<slug>`)
  })

  it('asks a category only of accepted prefixes, and only an existing one', () => {
    expect([...branchCategory]).toEqual([['fix', 'bug']])
    for (const [prefix, label] of branchCategory) {
      expect(branchPrefixes).toContain(prefix)
      expect(categoryLabels).toContain(label)
    }
  })
})

describe('kindOf and sectionsFor', () => {
  it('finds exactly one category, or none', () => {
    expect(kindOf(['bug', 'ready-for-agent'])).toEqual({
      kind: 'bug',
      found: ['bug'],
    })
    expect(kindOf(['bug', 'enhancement'])).toEqual({
      kind: null,
      found: ['bug', 'enhancement'],
    })
    expect(kindOf(['ready-for-agent'])).toEqual({ kind: null, found: [] })
  })

  it('asks a bug for a cause and anything else for a feature plan', () => {
    expect(sectionsFor('bug')).toBe(bugSections)
    expect(sectionsFor('enhancement')).toBe(featureSections)
    expect(sectionsFor(null)).toBe(featureSections)
  })
})

describe('foldHeading and matchesHeading', () => {
  it('folds case, accents and trailing punctuation', () => {
    expect(foldHeading('Critérios de Aceite:')).toBe('criterios de aceite')
    expect(foldHeading('  CONTEXTO E PORQUÊ.  ')).toBe('contexto e porque')
    expect(foldHeading(undefined)).toBe('')
  })

  it('folds a decomposed accent as it folds a composed one', () => {
    expect(foldHeading('Crite\u0301rios')).toBe('criterios')
    expect(foldHeading('Crit\u00e9rios')).toBe('criterios')
  })

  it('keeps the accent range escaped in the source, never as raw combining marks', () => {
    // A raw combining mark renders fused onto the bracket beside it, so a
    // reader cannot see which range the regular expression strips.
    const source = readFileSync(
      path.join(root, 'scripts', 'loop-sections.mjs'),
      'utf8',
    )
    expect(source).not.toMatch(/[\u0300-\u036f]/)
    expect(source).toContain(String.raw`.replace(/[\u0300-\u036f]/g, '')`)
  })

  it.each([
    ['critérios de aceite', 'Critérios de aceite'],
    ['Criterios de aceite', 'Critérios de aceite'],
    ['CRITÉRIOS DE ACEITE:', 'Critérios de aceite'],
    ['Critérios de aceitação', 'Critérios de aceite'],
    ['Contexto', 'Contexto e porquê'],
    ['Motivação', 'Contexto e porquê'],
    ['Perguntas para o dono', 'Perguntas para o Approve'],
    ['Riscos: HIGH', 'Riscos'],
    ['Risco', 'Riscos'],
  ])('accepts %j for %j', (found, required) => {
    expect(matchesHeading(found, required)).toBe(true)
  })

  it.each([
    ['Acceptance criteria', 'Critérios de aceite'],
    ['Context and why', 'Contexto e porquê'],
    ['Risks', 'Riscos'],
    ['Plan', 'Plano'],
    ['Root cause', 'Causa raiz'],
  ])('refuses the English %j for %j', (found, required) => {
    expect(matchesHeading(found, required)).toBe(false)
  })
})

describe('parseSections', () => {
  // GitHub renders `texto <!--` as text and the next `## Riscos` as a real
  // heading: an ATX heading interrupts the paragraph, so the inline comment
  // never forms (checked with GitHub's markdown API on PR #14). A block comment
  // that opens a line hides its lines until `-->`, even one between backticks.
  it('reads a heading after an inline `<!--` as a section, as GitHub does', () => {
    const titles = parseSections('texto <!--\n## Riscos\nHIGH\n-->').map(
      (section) => section.title,
    )
    expect(titles).toEqual(['Riscos'])
  })

  it('ends a block comment at a `-->` between backticks, as GitHub does', () => {
    const titles = parseSections(
      '<!--\n## Escondido\ncom `-->` no meio\n## Depois\n-->',
    ).map((section) => section.title)
    expect(titles).toEqual(['Depois'])
  })

  it('keeps a nested heading inside its parent section', () => {
    const sections = parseSections(
      '## Plano\n\ntexto\n\n### Contratos\n\n- a\n\n## Riscos\n\nNORMAL',
    )
    expect(sections.map(({ title, level }) => [title, level])).toEqual([
      ['Plano', 2],
      ['Contratos', 3],
      ['Riscos', 2],
    ])
    expect(sections[0].content).toContain('### Contratos')
    expect(sections[0].content).toContain('- a')
    expect(sections[1].content).toBe('- a')
    expect(sections[2].content).toBe('NORMAL')
  })

  it('ignores headings inside fenced code, backtick or tilde', () => {
    const sections = parseSections(
      [
        '## A',
        '```md',
        '## Não é seção',
        '~~~',
        '## Ainda não é',
        '```',
        '~~~',
        '# Nem esta',
        '~~~',
        '## B',
        'b',
      ].join('\n'),
    )
    expect(sections.map(({ title }) => title)).toEqual(['A', 'B'])
    expect(sections[0].content).toContain('## Não é seção')
  })

  // The rendered issue shows no heading inside a comment, so neither does
  // the gate: a commented-out required section is missing (#12).
  it('ignores headings inside an HTML comment block', () => {
    const text = [
      '## A',
      'a',
      '<!--',
      '## Critérios de aceite',
      '- [ ] escondido',
      '-->',
      '<!-- ## Nem esta -->',
      '  <!-- rascunho',
      '# Nem esta outra',
      'fim --> ## Nem aqui',
      '## B',
      'b',
    ].join('\n')
    expect(parseSections(text).map(({ title }) => title)).toEqual(['A', 'B'])
    expect(criteriaSection(text)).toBe('')
    expect(checkSections(text, 'enhancement').missing).toContain(
      'Critérios de aceite',
    )
  })

  it('reads a heading after a comment that closes, and none after one left open', () => {
    expect(
      parseSections('<!-- nota -->\n## A\n\na').map(({ title }) => title),
    ).toEqual(['A'])
    expect(
      parseSections('## A\n\n<!-- rascunho\n\n## B\n\nb').map(
        ({ title }) => title,
      ),
    ).toEqual(['A'])
  })

  // CommonMark fences: a closing fence is the opener's character, at least
  // as long, with nothing after it; an opener indented four spaces is code
  // of another kind, not a fence (#12).
  it.each([
    [
      'a longer fence around a shorter one',
      ['````md', '```md', '## Não é seção', '```', '````', '## B'],
    ],
    [
      'a line with an info string inside a fence',
      ['```', '```js', '## Não é seção', '```', '## B'],
    ],
    [
      'a shorter run inside a longer fence',
      ['~~~~', '~~~', '## Não é seção', '~~~~', '## B'],
    ],
    [
      'a closer indented up to three spaces',
      ['```', '## Não é seção', '   ```', '## B'],
    ],
  ])('finds only the heading after %s', (_, lines) => {
    expect(parseSections(lines.join('\n')).map(({ title }) => title)).toEqual([
      'B',
    ])
  })

  it.each([
    ['a closer with text after it', ['```', '``` fim', '## B']],
    ['a closer indented four spaces', ['```', '    ```', '## B']],
    ['a fence left open', ['## A', '```', '## B']],
  ])('finds no heading after %s', (_, lines) => {
    expect(
      parseSections(lines.join('\n'))
        .map(({ title }) => title)
        .filter((title) => title === 'B'),
    ).toEqual([])
  })

  // A fence under a list item hides the lines of the item; a heading at the
  // margin ends the item, and the fence with it.
  it('finds the heading at the margin after a fence left open under a list item', () => {
    const lines = ['1. Exemplo:', '', '    ```md', '    ## Não é seção', '## B']
    expect(parseSections(lines.join('\n')).map(({ title }) => title)).toEqual([
      'B',
    ])
  })

  it.each([
    ['indented four spaces', ['    ```', '## A']],
    ['with a backtick in its info string', ['``` a`b', '## A']],
    ['of two backticks', ['``', '## A']],
  ])('does not open a fence on a line %s', (_, lines) => {
    expect(parseSections(lines.join('\n')).map(({ title }) => title)).toEqual([
      'A',
    ])
  })

  it('reads levels 1 to 4 only, and strips closing hashes', () => {
    const sections = parseSections('#### Quatro\n\n##### Cinco\n\n## Riscos ##')
    expect(sections.map(({ title }) => title)).toEqual(['Quatro', 'Riscos'])
    expect(sections[0].content).toBe('##### Cinco')
  })

  it('reads nothing from nothing', () => {
    expect(parseSections('')).toEqual([])
    expect(parseSections(null)).toEqual([])
  })
})

describe('hasContent and countCriteria', () => {
  it.each(['', '   ', '_No response_', '\n_No response_\n', null, undefined])(
    'treats %j as empty',
    (content) => {
      expect(hasContent(content)).toBe(false)
    },
  )

  it('treats any other text as written', () => {
    expect(hasContent('x')).toBe(true)
  })

  // GitHub shows a section that holds only a comment as empty (#12).
  it.each([
    ['a one-line comment', '<!-- HIGH ou NORMAL -->'],
    ['a comment over several lines', '<!--\nHIGH ou NORMAL\n-->'],
    ['a comment left open', '<!-- HIGH ou NORMAL'],
    [
      'two comments and a form answer',
      '<!-- a -->\n\n<!-- b -->\n_No response_',
    ],
    ['comments on one line', '<!-- a --> <!-- b -->'],
  ])('treats a section with only %s as empty', (_, content) => {
    expect(hasContent(content)).toBe(false)
  })

  // Fenced code is visible content, and text beside a comment is shown.
  it.each([
    ['fenced code', '```\nHIGH\n```'],
    ['a fence that holds a comment', '```html\n<!-- HIGH -->\n```'],
    ['text after a comment block', '<!-- nota -->\n\nNORMAL'],
    ['text before an inline comment', 'NORMAL <!-- ou HIGH -->'],
    ['a code span that mentions a comment', '`<!--`'],
  ])('treats a section with %s as written', (_, content) => {
    expect(hasContent(content)).toBe(true)
  })

  it('counts checklist items with text after the box', () => {
    expect(countCriteria('- [ ] a\n- [x] b\n* [X] c\n  - [ ] aninhado')).toBe(4)
  })

  it.each(['- [ ]', '- [ ]   ', '-[ ] a', '1. [ ] a', '- [y] a', '- a', ''])(
    'does not count %j',
    (content) => {
      expect(countCriteria(content)).toBe(0)
    },
  )

  // What the rendered issue shows: a box in sample code or in a comment
  // GitHub hides is no criterion.
  it.each([
    ['backtick fenced code', '```md\n- [ ] exemplo\n```'],
    ['tilde fenced code', '~~~\n- [ ] exemplo\n~~~'],
    ['a fence left open', 'Exemplo:\n\n```\n- [ ] exemplo'],
    ['a fence with a tilde line inside', '```\n~~~\n- [ ] exemplo\n```'],
    ['a comment over several lines', '<!--\n- [ ] escondido\n-->'],
    ['a comment on one line', '<!-- - [ ] escondido -->'],
    ['a comment left open', 'Nota:\n\n<!-- rascunho\n- [ ] escondido'],
    ['a line that opens with a comment', '<!-- nota --> - [ ] escondido'],
    ['a box with only a comment after it', '- [ ] <!-- a preencher -->'],
    [
      'a three-backtick sample inside a four-backtick fence',
      '````md\nExemplo:\n\n```md\n- [ ] exemplo\n```\n````',
    ],
    [
      'a three-backtick fence whose js line does not close it',
      '```\n```js\n- [ ] exemplo\n```',
    ],
    ['a fence whose closer has text after it', '```\n``` fim\n- [ ] exemplo'],
    [
      'a fence left open after a real closer of another fence',
      '```\n```\n~~~\n- [ ] exemplo',
    ],
    [
      'a comment block over several lines, text after its close',
      '<!-- rascunho\n- [ ] escondido\n--> - [ ] escondido também',
    ],
  ])('does not count a box in %s', (_, content) => {
    expect(countCriteria(content)).toBe(0)
  })

  it('counts the boxes around fenced code and comments, and reads a code span as text', () => {
    const content = [
      '- [ ] antes',
      '```',
      '- [ ] no código',
      '```',
      '- [ ] depois do código <!-- com uma nota -->',
      '<!--',
      '- [ ] no comentário',
      '-->',
      '- [ ] fala de `<!--` num trecho de código',
      '- [ ] <!-- nota --> e texto depois',
      '~~~',
      '- [ ] no código de novo',
      '~~~',
      '  - [x] aninhado',
    ].join('\n')
    expect(countCriteria(content)).toBe(5)
  })

  // A code example indented under a list item is fenced code: GitHub shows
  // no box in it (#12). Erring on the side that blocks, a fence indented four
  // spaces or more counts right under a list item or its continuation.
  it.each([
    [
      'a numbered item',
      '1. Exemplo:\n\n    ```md\n    - [ ] O gate abre.\n    ```',
    ],
    ['a bullet', '- Exemplo:\n\n    ```md\n    - [ ] O gate abre.\n    ```'],
    [
      'a star bullet',
      '* Exemplo:\n\n    ```md\n    - [ ] O gate abre.\n    ```',
    ],
    [
      'a parenthesis number',
      '1) Exemplo:\n\n    ```md\n    - [ ] O gate abre.\n    ```',
    ],
    [
      'a continuation line of an item',
      '1. Exemplo:\n   com mais texto.\n\n    ~~~\n    - [ ] O gate abre.\n    ~~~',
    ],
    [
      'a lazy continuation line of an item',
      '1. Exemplo:\ncom mais texto.\n\n    ```\n    - [ ] O gate abre.\n    ```',
    ],
    [
      'an item nested deeper',
      '- a\n    - b\n\n        ```\n        - [ ] c\n        ```',
    ],
    [
      'a tab-indented fence',
      '1. Exemplo:\n\n\t```md\n\t- [ ] O gate abre.\n\t```',
    ],
  ])('does not count a box in fenced code under %s', (_, content) => {
    expect(countCriteria(content)).toBe(0)
  })

  it('counts the boxes around fenced code under list items', () => {
    const content = [
      '1. Exemplo:',
      '',
      '    ```md',
      '    - [ ] exemplo',
      '    ```',
      '',
      '- [ ] real depois do exemplo',
      '',
      '2. Outro exemplo:',
      '',
      '    ```md',
      '    - [ ] exemplo',
      '    ```',
      '    - [ ] continuação real do item',
      '- [x] outro real',
      '',
      '    ```md',
      '    - [ ] exemplo sob um item de checklist',
      '    ```',
    ].join('\n')
    expect(countCriteria(content)).toBe(3)
  })

  // Inside a fence under a list item, a fence line indented more than three
  // columns past the opening one is code, as it is to GitHub, and does not
  // close the fence early.
  it('does not close a fence under a list item on a deeper-indented fence line', () => {
    const content = [
      '1. Exemplo:',
      '',
      '    ```md',
      '    - item',
      '',
      '        ```',
      '        - [ ] exemplo',
      '    ```',
      '- [ ] real',
    ].join('\n')
    expect(countCriteria(content)).toBe(1)
  })

  // The item's text starts at most three columns left of its fence: a line
  // further left ends the item and the fence in it, as it does on GitHub.
  it('ends a fence under a list item at a line left of the item', () => {
    expect(
      countCriteria('1. Exemplo:\n\n    ```md\n    - [ ] exemplo\n- [ ] real'),
    ).toBe(1)
  })

  // Away from a list, a fence indented four spaces is indented code, as
  // before: the fence is text, so the box in it still counts.
  it.each([
    [
      'after a paragraph',
      'Exemplo:\n\n    ```md\n    - [ ] O gate abre.\n    ```',
    ],
    [
      'right below a heading',
      '### Exemplo\n    ```md\n    - [ ] O gate abre.\n    ```',
    ],
    [
      'after a list that a paragraph ended',
      '- item\n\nParágrafo.\n\n    ```md\n    - [ ] O gate abre.\n    ```',
    ],
    [
      'after a list that a heading ended',
      '- item\n### Exemplo\n\n    ```md\n    - [ ] O gate abre.\n    ```',
    ],
    [
      'after a list that a fence at the margin ended',
      '- item\n```\ncódigo\n```\n\n    ```md\n    - [ ] O gate abre.\n    ```',
    ],
  ])('still counts a box in a four-space fence %s', (_, content) => {
    expect(countCriteria(content)).toBe(1)
  })

  it('counts a box after a fence that closed, and none after one left open', () => {
    expect(countCriteria('````\n```\n````\n- [ ] depois')).toBe(1)
    expect(countCriteria('- [ ] antes\n```\n- [ ] dentro\n- [ ] ainda')).toBe(1)
  })

  it('reads criteria from the section with its fenced sample left out', () => {
    const plan =
      '## Critérios de aceite\n\n- [ ] real\n\n```md\n- [ ] exemplo\n## Riscos\n```\n\n## Riscos\n\nNORMAL'
    expect(countCriteria(criteriaSection(plan))).toBe(1)
  })
})

describe('checkSections and criteriaSection', () => {
  const plan = (sections: readonly { heading: string }[], skip = '') =>
    sections
      .filter(({ heading }) => heading !== skip)
      .map(({ heading }) => `## ${heading}\n\nTexto.`)
      .join('\n\n')

  it('passes a plan with every section of its kind', () => {
    expect(checkSections(plan(featureSections), 'enhancement')).toMatchObject({
      missing: [],
      empty: [],
    })
    expect(checkSections(plan(bugSections), 'bug')).toMatchObject({
      missing: [],
      empty: [],
    })
  })

  it('names what is missing and what a form left blank', () => {
    const text = plan(featureSections, 'Riscos').replace(
      '## Estado atual\n\nTexto.',
      '## Estado atual\n\n_No response_',
    )
    expect(checkSections(text, 'enhancement')).toMatchObject({
      missing: ['Riscos'],
      empty: ['Estado atual'],
    })
  })

  it('measures a bug against the bug sections', () => {
    const { missing } = checkSections(plan(featureSections), 'bug')
    expect(missing).toContain('Causa raiz')
  })

  it('accepts a pt-BR alternative and refuses an English heading', () => {
    const base = plan(featureSections, 'Critérios de aceite')
    expect(
      checkSections(
        `${base}\n\n## Critérios de aceitação\n\n- [ ] a`,
        'enhancement',
      ).missing,
    ).toEqual([])
    expect(
      checkSections(
        `${base}\n\n## Acceptance criteria\n\n- [ ] a`,
        'enhancement',
      ).missing,
    ).toEqual(['Critérios de aceite'])
  })

  it('returns the criteria section content, or nothing', () => {
    expect(
      criteriaSection('## Critérios de aceite\n\n- [ ] a\n\n## Riscos\n\nx'),
    ).toBe('- [ ] a')
    expect(criteriaSection('## Riscos\n\nx')).toBe('')
  })

  it('finds the first section a required heading accepts, or null', () => {
    const text = '## Contexto\n\na\n\n## Plano\n\nb\n\n### Passos\n\nc'
    expect(findSection(text, 'Contexto e porquê')?.content).toBe('a')
    expect(findSection(text, 'Plano')?.content).toBe('b\n\n### Passos\n\nc')
    expect(findSection(text, 'Riscos')).toBeNull()
  })

  it('prefers an exact heading over an earlier one that only starts with it', () => {
    const text = '### Plano de testes\n\ntestes\n\n### Plano\n\npassos'
    expect(findSection(text, 'Plano')?.content).toBe('passos')
    expect(findSection('### Plano:\n\np', 'Plano')?.content).toBe('p')
    // An exact alternative counts as exact too.
    expect(
      findSection('## Riscos altos\n\na\n\n## Risco\n\nb', 'Riscos')?.content,
    ).toBe('b')
  })

  it('falls back to a heading that starts with the name when none is exact', () => {
    expect(findSection('## Riscos: HIGH\n\nx', 'Riscos')?.content).toBe('x')
  })

  it('judges the exact section for emptiness, not an earlier prefixed one', () => {
    const text = featureSections
      .map(({ heading }) =>
        heading === 'Plano'
          ? '## Plano de testes\n\nTestes.\n\n## Plano\n\n_No response_'
          : `## ${heading}\n\nTexto.`,
      )
      .join('\n\n')
    expect(checkSections(text, 'enhancement')).toMatchObject({
      missing: [],
      empty: ['Plano'],
    })
  })
})

describe('branchSectionFor and planCitesBranch', () => {
  const branch = 'feature/2-loop-minimo'

  it('reads the branch from Plano, or from Onde será corrigido in a bug', () => {
    expect(branchSectionFor('enhancement')).toBe('Plano')
    expect(branchSectionFor(null)).toBe('Plano')
    expect(branchSectionFor('bug')).toBe('Onde será corrigido')
  })

  it('finds the exact branch inside the section, nested headings included', () => {
    expect(
      planCitesBranch(
        `## Plano\n\n### Branch\n\n\`${branch}\`\n\n## Riscos\n\nx`,
        branch,
        'enhancement',
      ),
    ).toEqual({ heading: 'Plano', section: true, cited: true })
    expect(
      planCitesBranch(
        '## Onde será corrigido\n\nBranch: fix/3-a.',
        'fix/3-a',
        'bug',
      ).cited,
    ).toBe(true)
  })

  it.each([
    ['a longer name', `## Plano\n\n\`${branch}-v2\``],
    ['a name with a suffix path', `## Plano\n\n${branch}/x`],
    [
      'a mention outside Plano',
      `## Fora de escopo\n\nNão usar ${branch}.\n\n## Plano\n\n1. Fazer.`,
    ],
    ['a mention before any section', `${branch}\n\n## Plano\n\n1. Fazer.`],
    ['a dotted suffix', `## Plano\n\nBranch: \`${branch}.old\`.`],
    ['a dotted number', `## Plano\n\n${branch}.2`],
    ['a dotted accented word', `## Plano\n\n${branch}.ção`],
    ['a dot and a hyphen', `## Plano\n\n${branch}.-x`],
    ['a dot and a path', `## Plano\n\n${branch}./x`],
    ['an accented prefix', `## Plano\n\nç${branch}`],
  ])('does not count %s', (_, text) => {
    expect(planCitesBranch(text, branch, 'enhancement').cited).toBe(false)
  })

  it.each([
    ['a period that ends the plan', `## Plano\n\nBranch ${branch}.`],
    ['a period that ends a line', `## Plano\n\nBranch ${branch}.\n\n1. Fazer.`],
    [
      'a period before a space',
      `## Plano\n\nA branch ${branch}. Depois, o PR.`,
    ],
    ['a period inside parentheses', `## Plano\n\n(branch ${branch}.)`],
    ['an ellipsis', `## Plano\n\nBranch ${branch}...`],
    ['a period after code', `## Plano\n\nBranch: \`${branch}\`.`],
    ['a period in bold', `## Plano\n\n**${branch}.**`],
  ])('counts the branch before %s', (_, text) => {
    expect(planCitesBranch(text, branch, 'enhancement').cited).toBe(true)
  })

  // Plano is read as GitHub shows it (#12): a name only inside an HTML
  // comment cites nothing; fenced code and code spans are visible.
  it.each([
    [
      'a comment block',
      `## Plano\n\n<!--\nBranch: ${branch}\n-->\n\n1. Fazer.`,
    ],
    ['a one-line comment block', `## Plano\n\n<!-- ${branch} -->\n\n1. Fazer.`],
    ['an inline comment', `## Plano\n\n1. Fazer. <!-- ${branch} -->`],
    ['a comment left open', `## Plano\n\n1. Fazer.\n\n<!-- rascunho ${branch}`],
  ])('does not count the branch only inside %s', (_, text) => {
    expect(planCitesBranch(text, branch, 'enhancement').cited).toBe(false)
  })

  it.each([
    ['fenced code', `## Plano\n\n\`\`\`sh\ngit switch -c ${branch}\n\`\`\``],
    [
      'fenced code under a list item',
      `## Plano\n\n1. Cortar:\n\n    \`\`\`sh\n    git switch -c ${branch}\n    \`\`\``,
    ],
    [
      'fenced code that holds a comment',
      `## Plano\n\n\`\`\`html\n<!-- ${branch} -->\n\`\`\``,
    ],
    ['text after a comment', `## Plano\n\n<!-- nota -->\n\nBranch: ${branch}.`],
  ])('counts the branch cited in %s', (_, text) => {
    expect(planCitesBranch(text, branch, 'enhancement').cited).toBe(true)
  })

  it('reads the branch from the exact Plano, not from "Plano de testes" before it', () => {
    const text = `### Plano de testes\n\n- testes\n\n### Plano\n\nBranch: \`${branch}\`.`
    expect(planCitesBranch(text, branch, 'enhancement').cited).toBe(true)
  })

  it('says when the section is missing', () => {
    expect(
      planCitesBranch(`## Riscos\n\n${branch}`, branch, 'enhancement'),
    ).toEqual({
      heading: 'Plano',
      section: false,
      cited: false,
    })
  })
})

describe('headAndRest and currentPlan', () => {
  it('splits the first non-empty line from the rest', () => {
    expect(headAndRest('\n\n# Owner Approve\n\npalavras\n')).toEqual({
      head: '# Owner Approve',
      rest: 'palavras',
    })
    expect(headAndRest('   \n')).toEqual({ head: '', rest: '' })
  })

  const plan = (body: string, createdAt: string) => ({ body, createdAt })

  it('falls back to the issue body', () => {
    expect(currentPlan({ body: 'corpo', comments: [] })).toMatchObject({
      source: 'body',
      text: 'corpo',
      comment: null,
    })
  })

  it('takes the latest "# Plano" comment by date, not by order', () => {
    const later = plan('# Plano\n\nsegundo', '2026-09-20T12:00:00Z')
    const earlier = plan('# Plano\n\nprimeiro', '2026-09-20T11:00:00Z')
    expect(currentPlan({ body: 'corpo', comments: [later, earlier] })).toEqual({
      source: 'comment',
      text: 'segundo',
      comment: later,
    })
  })

  it('takes "# Plano" with trailing spaces or after blank lines', () => {
    for (const body of ['# Plano   \n\nx', '\n\n# Plano\n\nx'])
      expect(
        currentPlan({
          body: 'corpo',
          comments: [plan(body, '2026-09-20T12:00:00Z')],
        }).text,
      ).toBe('x')
  })

  it.each([
    '## Plano\n\nx',
    '# Planos\n\nx',
    'Plano\n\nx',
    '# O Plano\n\nx',
    '# Plano revisado\n\nx',
    '# Plano de testes\n\nx',
    '# Plano: revisão\n\nx',
    '# plano\n\nx',
    '#  Plano\n\nx',
    '#Plano\n\nx',
  ])('does not take %j for a plan revision', (body) => {
    expect(
      currentPlan({
        body: 'corpo',
        comments: [plan(body, '2026-09-20T12:00:00Z')],
      }).source,
    ).toBe('body')
  })
})

describe('approveState', () => {
  const ownerLogin = 'dono'
  const owner = { __typename: 'User', login: ownerLogin }
  const at = (time: string) => `2026-09-20T${time}:00Z`
  const said = (
    body: string,
    createdAt: string,
    extra: Partial<IssueComment> = {},
  ): IssueComment => ({ body, createdAt, author: owner, ...extra })
  const approve = (
    createdAt = at('12:00'),
    extra: Partial<IssueComment> = {},
  ) => said('# Owner Approve\n\nPode seguir.', createdAt, extra)
  const ready = (createdAt = at('12:05'), actor = owner): TimelineEvent => ({
    __typename: 'LabeledEvent',
    createdAt,
    actor,
    label: { name: 'ready-for-agent' },
  })
  const reopened = (createdAt: string): TimelineEvent => ({
    __typename: 'ReopenedEvent',
    createdAt,
  })
  const deletedAt = (createdAt: string): TimelineEvent => ({
    __typename: 'CommentDeletedEvent',
    createdAt,
  })
  const state = ({
    comments = [approve()],
    events = [ready()],
    lastEditedAt = null,
  }: {
    comments?: IssueComment[]
    events?: TimelineEvent[]
    lastEditedAt?: string | null
  } = {}) =>
    approveState({ issue: { lastEditedAt }, comments, events, ownerLogin })

  it('stands on the owner’s words, followed by the owner’s label', () => {
    const result = state()
    expect(result).toMatchObject({ ok: true, code: 'ok' })
    expect(result.detail).toContain(at('12:00'))
    expect(result.approve?.createdAt).toBe(at('12:00'))
  })

  it('accepts the exact heading after blank lines and with trailing spaces', () => {
    expect(
      state({ comments: [said('\n\n# Owner Approve  \n\nsim', at('12:00'))] })
        .ok,
    ).toBe(true)
  })

  it.each([
    '## Owner Approve',
    '#### owner approve',
    '#Owner Approve',
    '# owner approve',
    '# Owner  Approve',
    '# Owner Approve: sim',
    '# Owner Approve retirado',
    '# OWNER APPROVE',
  ])('does not take the near miss %j for an Approve, and says so', (head) => {
    const result = state({ comments: [said(`${head}\n\nsim`, at('12:00'))] })
    expect(result).toMatchObject({ ok: false, code: 'ambiguous-approve' })
    expect(result.detail).toContain(`"${head}"`)
    expect(result.detail).toContain('não conta como Approve')
  })

  it.each([
    ['no comment at all', []],
    ['an unheaded approval', [said('aprovado, pode seguir', at('12:00'))]],
    ['a lone withdrawal', [said('# Approve retirado\n\nx', at('12:00'))]],
    ['a heading that names no Approve', [said('# Aprovado\n\nx', at('12:00'))]],
  ])('finds none in %s', (_, comments) => {
    expect(state({ comments: comments as IssueComment[] })).toMatchObject({
      ok: false,
      code: 'none',
    })
  })

  it.each([
    '# Approve retirado.',
    '# Approve retirado: rever riscos',
    '# Owner Approve retirado',
    '# Retiro o Approve',
    '## Approve retirado',
    '# approve retirado',
    '## Owner Approve',
    '#### owner approve',
  ])('is cancelled by the near miss %j after it', (head) => {
    const result = state({
      comments: [approve(), said(`${head}\n\nRevendo.`, at('12:30'))],
    })
    expect(result).toMatchObject({ ok: false, code: 'ambiguous-approve' })
    expect(result.detail).toContain(`"${head}"`)
    expect(result.detail).toContain('cancela o Approve anterior')
  })

  it('is cancelled by a near miss from anyone, not only the owner', () => {
    expect(
      state({
        comments: [
          approve(),
          said('# Approve retirado!\n\nx', at('12:30'), {
            author: { __typename: 'Bot', login: 'github-actions' },
          }),
        ],
      }).code,
    ).toBe('ambiguous-approve')
  })

  it.each([
    ['an h5', '##### Approve retirado'],
    ['an h6', '###### Approve retirado'],
    ['a heading with no space after the hash', '#Approve retirado'],
    ['a line wholly in bold', '**Approve retirado**'],
    ['a line wholly in bold, with underscores', '__Approve retirado__'],
    ['a quoted heading', '> # Approve retirado'],
    ['a quoted bold line', '> **Approve retirado**'],
    ['a setext h1', 'Approve retirado\n==='],
    ['a setext h2', 'Approve retirado\n---'],
    ['a quoted setext heading', '> Approve retirado\n> ==='],
  ])('is cancelled by %s that mentions Approve', (_, opening) => {
    const result = state({
      comments: [approve(), said(`${opening}\n\nRevendo.`, at('12:30'))],
    })
    expect(result).toMatchObject({ ok: false, code: 'ambiguous-approve' })
    expect(result.detail).toContain('cancela o Approve anterior')
  })

  it.each([
    ['an issue reference', '#5 aguarda o Approve desta'],
    ['a quoted issue reference', '> #5 aguarda o Approve desta'],
    ['a line that is no heading', 'Sobre o Approve: tudo certo.'],
    ['plain prose that reads like a withdrawal', 'Approve retirado'],
    ['seven hashes, which make no heading', '####### Approve retirado'],
    ['bold that does not cover the line', '**Approve** retirado'],
    ['a line set apart from a rule by a blank line', 'Approve retirado\n\n==='],
  ])('is not cancelled by %s', (_, opening) => {
    expect(
      state({ comments: [approve(), said(`${opening}\n\nx`, at('12:30'))] }).ok,
    ).toBe(true)
  })

  it('takes approveLikeHeading as a heading-like first line that mentions Approve', () => {
    for (const line of [
      '# Retiro o APPROVE',
      '#### approve',
      '###### approve',
      '#Owner Approve',
      '#approve',
      '**Approve retirado**',
      '__approve__',
      '> # Approve retirado',
      '>> ## approve',
    ])
      expect(approveLikeHeading.test(line), line).toBe(true)
    for (const line of [
      '####### approve',
      '#5 aguarda o Approve',
      '##5 approve',
      '> #5 approve',
      'approve',
      '**Approve** retirado',
      '# Retiro o aval',
    ])
      expect(approveLikeHeading.test(line), line).toBe(false)
  })

  it('is withdrawn by the exact "# Approve retirado", trailing spaces aside', () => {
    expect(
      state({
        comments: [approve(), said('# Approve retirado   ', at('12:30'))],
      }).code,
    ).toBe('withdrawn')
  })

  it('is withdrawn by "# Approve retirado", with text after it', () => {
    const result = state({
      comments: [
        approve(),
        said('# Approve retirado\n\nRevendo.', at('12:30')),
      ],
    })
    expect(result).toMatchObject({ ok: false, code: 'withdrawn' })
  })

  it('stands again after a later Approve', () => {
    const result = state({
      comments: [
        approve(at('11:00')),
        said('# Approve retirado\n\nRevendo.', at('11:30')),
        approve(),
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('reads comments by date, not by the order given', () => {
    const result = state({
      comments: [said('# Approve retirado\n\nx', at('12:30')), approve()],
    })
    expect(result.code).toBe('withdrawn')
  })

  it.each([
    ['another user', { __typename: 'User', login: 'outra' }],
    ['a bot with the owner’s login', { __typename: 'Bot', login: ownerLogin }],
    ['a deleted account', null],
  ])('refuses an Approve by %s', (_, author) => {
    expect(state({ comments: [approve(at('12:00'), { author })] }).code).toBe(
      'not-owner',
    )
  })

  // Only the acts that open the gate need the owner: the Approve (above) and
  // the label (below). Every act that closes it counts from anyone, because
  // in doubt the gate blocks (#12).
  describe.each([
    ['another user', { __typename: 'User', login: 'outra' }],
    ['a bot with the owner’s login', { __typename: 'Bot', login: ownerLogin }],
    ['a deleted account', null],
  ])('an act that closes the gate, by %s', (_, author) => {
    it.each([
      ['the withdrawal', '# Approve retirado\n\nx', 'withdrawn'],
      [
        'a near-miss withdrawal',
        '## Approve retirado\n\nx',
        'ambiguous-approve',
      ],
      [
        'a near-miss Approve',
        '# Owner Approve retirado\n\nx',
        'ambiguous-approve',
      ],
      ['a "# Plano"', '# Plano\n\nnovo', 'revised'],
    ])('cancels the owner’s Approve: %s', (_, body, code) => {
      expect(
        state({
          comments: [approve(), said(body, at('12:30'), { author })],
        }),
      ).toMatchObject({ ok: false, code })
    })

    it('cancels the owner’s Approve: an edit', () => {
      expect(
        state({
          comments: [
            approve(),
            said('Uma resposta.', at('12:10'), {
              author,
              lastEditedAt: at('12:30'),
            }),
          ],
        }).code,
      ).toBe('comment-edited')
    })

    it('cancels the owner’s Approve: a deletion', () => {
      expect(
        state({
          events: [
            ready(),
            {
              __typename: 'CommentDeletedEvent',
              createdAt: at('12:30'),
              actor: author,
            },
          ],
        }).code,
      ).toBe('comment-deleted')
    })

    it('neither opens the gate nor cancels the owner’s Approve with a "# Owner Approve"', () => {
      expect(state({ comments: [approve(at('12:30'), { author })] }).code).toBe(
        'not-owner',
      )
      expect(
        state({
          comments: [approve(), approve(at('12:30'), { author })],
        }),
      ).toMatchObject({ ok: true, code: 'ok' })
    })
  })

  it('refuses an Approve without words below the heading', () => {
    expect(
      state({ comments: [said('# Owner Approve\n\n   ', at('12:00'))] }).code,
    ).toBe('no-words')
  })

  it('is cancelled by a later "# Plano"', () => {
    expect(
      state({ comments: [approve(), said('# Plano\n\nnovo', at('12:10'))] })
        .code,
    ).toBe('revised')
  })

  it.each(['# Plano de testes', '# Plano revisado', '## Plano', '# plano'])(
    'is not cancelled by %j, which is no plan revision',
    (head) => {
      expect(
        state({ comments: [approve(), said(`${head}\n\nx`, at('12:10'))] }).ok,
      ).toBe(true)
    },
  )

  it('stops counting when the body is edited after it, or in its second', () => {
    expect(state({ lastEditedAt: at('12:30') }).code).toBe('body-edited')
    expect(state({ lastEditedAt: at('12:00') }).code).toBe('body-edited')
    expect(state({ lastEditedAt: at('11:30') }).ok).toBe(true)
  })

  it.each([
    ['a plan comment', '# Plano\n\nx'],
    ['a plan comment edited out of its heading', 'Era um plano.'],
    ['a plain comment', 'Uma resposta.'],
    ['an earlier Approve', '# Owner Approve\n\nprimeiro'],
  ])('stops counting when %s older than it is edited after it', (_, body) => {
    const result = state({
      comments: [
        said(body, at('11:00'), { lastEditedAt: at('12:30') }),
        approve(),
      ],
    })
    expect(result.code).toBe('comment-edited')
    expect(result.detail).toContain(at('11:00'))
  })

  it('stops counting when an older comment is edited in its second', () => {
    expect(
      state({
        comments: [
          said('x', at('11:00'), { lastEditedAt: at('12:00') }),
          approve(),
        ],
      }).code,
    ).toBe('comment-edited')
  })

  it('keeps counting when an older comment was edited before it', () => {
    expect(
      state({
        comments: [
          said('x', at('11:00'), { lastEditedAt: at('11:30') }),
          approve(),
        ],
      }).ok,
    ).toBe(true)
  })

  it('keeps counting when the Approve itself is edited', () => {
    expect(
      state({ comments: [approve(at('12:00'), { lastEditedAt: at('12:30') })] })
        .ok,
    ).toBe(true)
  })

  it('keeps counting when a newer comment was never edited', () => {
    // The shape of #2: Approve, label, the Approve edited, then an answer.
    expect(
      state({
        comments: [
          said('# Owner Approve\n\nPode seguir.', '2026-09-24T22:08:39Z', {
            lastEditedAt: '2026-09-24T22:09:49Z',
          }),
          said(
            '# Respondendo as perguntas:\n\n1. Sim.',
            '2026-09-24T22:09:58Z',
          ),
        ],
        events: [ready('2026-09-24T22:08:53Z')],
      }),
    ).toMatchObject({ ok: true, code: 'ok' })
  })

  it.each([
    [
      'a withdrawal edited away',
      '# Approve retirado\n\nRevendo.',
      'Tudo certo, pode seguir.',
      'withdrawn',
    ],
    [
      'a revision edited away',
      '# Plano\n\nnovo',
      'Plano antigo.\n\nnovo',
      'revised',
    ],
    ['a plain answer edited', 'Respostas.', 'Respostas corrigidas.', 'ok'],
  ])(
    'stops counting when a comment newer than it is edited: %s',
    (_, posted, edited, beforeEdit) => {
      // As posted, the comment has the effect its opening gives it; once
      // edited, only its edit time shows that anything happened.
      expect(
        state({ comments: [approve(), said(posted, at('12:10'))] }).code,
      ).toBe(beforeEdit)
      const result = state({
        comments: [
          approve(),
          said(edited, at('12:10'), { lastEditedAt: at('12:30') }),
        ],
      })
      expect(result.code).toBe('comment-edited')
      expect(result.detail).toContain(at('12:10'))
      expect(result.detail).toContain(at('12:30'))
    },
  )

  it('stops counting when a comment is deleted after it, or in its second', () => {
    expect(state({ events: [ready(), deletedAt(at('12:30'))] }).code).toBe(
      'comment-deleted',
    )
    expect(state({ events: [ready(), deletedAt(at('12:00'))] }).code).toBe(
      'comment-deleted',
    )
    expect(state({ events: [deletedAt(at('11:00')), ready()] }).ok).toBe(true)
  })

  it('needs ready-for-agent, applied last by the owner', () => {
    expect(state({ events: [] }).code).toBe('label-missing')
    expect(
      state({
        events: [ready(at('12:05'), { __typename: 'User', login: 'outra' })],
      }).code,
    ).toBe('label-not-owner')
    expect(
      state({
        events: [
          ready(at('12:10')),
          ready(at('12:05'), { __typename: 'User', login: 'outra' }),
        ],
      }).ok,
    ).toBe(true)
  })

  // The last application is the one judged, so another actor's, after the
  // owner's, cancels whoever it came from (#12).
  it.each([
    ['another user', { __typename: 'User', login: 'outra' }],
    ['a bot under the owner’s login', { __typename: 'Bot', login: ownerLogin }],
  ])(
    'stops counting when %s applies ready-for-agent after the owner',
    (_, actor) => {
      expect(
        state({ events: [ready(at('12:05')), ready(at('12:10'), actor)] }).code,
      ).toBe('label-not-owner')
    },
  )

  it('needs ready-for-agent applied after the Approve', () => {
    expect(state({ events: [ready(at('11:00'))] }).code).toBe(
      'label-before-approve',
    )
    expect(state({ events: [ready(at('12:00'))] }).code).toBe(
      'label-before-approve',
    )
    expect(state({ events: [ready(at('11:00'))] }).detail).toContain(
      'aplica a label de novo',
    )
  })

  it('needs the label applied again after a withdrawal and a new Approve', () => {
    const comments = [
      approve(at('11:00')),
      said('# Approve retirado\n\nRevendo.', at('11:30')),
      approve(at('12:00')),
    ]
    expect(state({ comments, events: [ready(at('11:05'))] }).code).toBe(
      'label-before-approve',
    )
    expect(
      state({ comments, events: [ready(at('11:05')), ready(at('12:05'))] }).ok,
    ).toBe(true)
  })

  it('needs the label applied again after a revision and a new Approve', () => {
    const comments = [
      approve(at('11:00')),
      said('# Plano\n\nnovo', at('11:30')),
      approve(at('12:00')),
    ]
    expect(state({ comments, events: [ready(at('11:05'))] }).code).toBe(
      'label-before-approve',
    )
  })

  it('does not survive a reopening', () => {
    expect(state({ events: [ready(), reopened(at('13:00'))] }).code).toBe(
      'before-reopen',
    )
  })

  it('needs the label again after a reopening', () => {
    expect(
      state({
        comments: [approve(at('14:00'))],
        events: [ready(), reopened(at('13:00'))],
      }).code,
    ).toBe('label-before-reopen')
    expect(
      state({
        comments: [approve(at('14:00'))],
        events: [ready(), reopened(at('13:00')), ready(at('14:05'))],
      }).ok,
    ).toBe(true)
  })
})

describe('commentOpening', () => {
  it.each([
    ['# Owner Approve\n\npalavras', 'approve'],
    ['\n  # Owner Approve  \n===', 'approve'],
    ['# Approve retirado', 'withdraw'],
    ['# Plano\n\nplano', 'plan'],
    ['## Owner Approve', 'approve-like'],
    ['##### Approve retirado', 'approve-like'],
    ['**Owner Approve**', 'approve-like'],
    ['> # Owner Approve', 'approve-like'],
    ['Owner Approve\n===', 'approve-like'],
    ['Approve retirado\r\n-', 'approve-like'],
    ['> Approve retirado\n>---', 'approve-like'],
    ['#5 aguarda o Approve', null],
    ['Sobre o Approve: tudo certo.', null],
    ['Plano\n===', null],
    ['## Plano', null],
    ['', null],
    [null, null],
  ] as const)('reads %j as %j', (body, opening) => {
    expect(commentOpening(body)).toBe(opening)
  })
})

describe('changelogHeadingFor', () => {
  const heading = changelogHeadingFor(2)

  it.each([
    '## 2026-09-24: Loop mínimo (#2)',
    '## 2026-09-24: Loop mínimo (#2, PR #10)',
  ])('matches %j', (line) => {
    expect(heading.test(line)).toBe(true)
  })

  it.each([
    '## 2026-09-24: Outra (#20)',
    '## 2026-09-24: Outra (#12)',
    'Algo sobre #2',
    '### 2026-09-24: Nível errado (#2)',
    '## 2026-9-24: Data curta (#2)',
    '## 2026-09-24: Sem parênteses #2',
    '## 2026-09-24: PR zero (#2, PR #0)',
  ])('does not match %j', (line) => {
    expect(heading.test(line)).toBe(false)
  })
})

describe('gateStatus', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const branch = 'feature/2-loop-minimo'
  const cache = (extra: Partial<GateCache> = {}): GateCache => ({
    schema: gateCacheSchema,
    branch,
    issue: 2,
    open: true,
    verified: true,
    checkedAt: '2026-09-24T11:00:00Z',
    ...extra,
  })
  const status = (value: GateCache | null, pendingSince?: string | null) =>
    gateStatus(value, { branch, now, pendingSince }).state

  it('is missing without a cache', () => {
    expect(status(null)).toBe('missing')
  })

  it.each([
    ['another schema', { schema: gateCacheSchema + 1 }],
    ['another branch', { branch: 'feature/3-outra' }],
    ['another issue', { issue: 3 }],
  ])('is a mismatch for %s', (_, extra) => {
    expect(status(cache(extra))).toBe('mismatch')
  })

  it.each([
    [
      'older than the TTL',
      new Date(now - (gateTtlHours + 1) * 36e5).toISOString(),
    ],
    ['from the future', '2026-09-24T13:00:00Z'],
    ['unreadable', 'ontem'],
  ])('is stale when checked %s', (_, checkedAt) => {
    expect(status(cache({ checkedAt }))).toBe('stale')
  })

  it('is pending-plan when a plan was accepted after the check', () => {
    expect(status(cache(), '2026-09-24T11:30:00Z')).toBe('pending-plan')
    expect(status(cache(), '2026-09-24T10:30:00Z')).toBe('open')
  })

  it('is unverified when the issue was not read', () => {
    expect(status(cache({ verified: false }))).toBe('unverified')
  })

  it('is open or closed as the gate said', () => {
    expect(status(cache())).toBe('open')
    expect(status(cache({ open: false }))).toBe('closed')
  })
})

describe('the Copilot reviewer and its request', () => {
  it('names Copilot by type and database id, with a readable login', () => {
    // Measured on PRs #10, #11 and #14: GraphQL gives this author on every
    // Copilot review and thread comment.
    expect(copilotReviewer).toEqual({
      typename: 'Bot',
      databaseId: 175728472,
      login: 'copilot-pull-request-reviewer',
    })
    expect(copilotRequestLogin).toBe('copilot-pull-request-reviewer[bot]')
    expect(copilotHandle).toBe('@copilot')
    expect(copilotRequestCommand(14)).toBe(
      'gh pr edit 14 --add-reviewer @copilot',
    )
  })

  it('counts only COMMENTED and APPROVED reviews', () => {
    expect(copilotReviewStates).toEqual(['COMMENTED', 'APPROVED'])
  })

  it('holds the audit to the rule only for merges after #10, #11 and #12', () => {
    expect(reviewRuleSince).toBe('2026-09-25T12:00:00Z')
    expect(new Date(reviewRuleSince).toISOString()).toBe(
      '2026-09-25T12:00:00.000Z',
    )
    // #10 and #11 were merged before it (their threads went to #12).
    for (const mergedAt of ['2026-09-25T00:46:02Z', '2026-09-25T04:43:52Z'])
      expect(mergedAt < reviewRuleSince).toBe(true)
  })

  it.each([
    [
      'the Copilot bot',
      { __typename: 'Bot', login: 'x', databaseId: 175728472 },
      true,
    ],
    [
      'a User named like Copilot',
      {
        __typename: 'User',
        login: 'copilot-pull-request-reviewer',
        databaseId: 175728472,
      },
      false,
    ],
    [
      'an Organization named like Copilot',
      {
        __typename: 'Organization',
        login: 'copilot-pull-request-reviewer',
        databaseId: 175728472,
      },
      false,
    ],
    [
      'another bot with Copilot’s login',
      {
        __typename: 'Bot',
        login: 'copilot-pull-request-reviewer',
        databaseId: 1,
      },
      false,
    ],
    [
      'Copilot without its database id',
      { __typename: 'Bot', login: 'copilot-pull-request-reviewer' },
      false,
    ],
    [
      'the database id as text',
      { __typename: 'Bot', databaseId: '175728472' as unknown as number },
      false,
    ],
    ['no author', null, false],
  ])('isCopilotReviewer: %s is %s', (_, author, expected) => {
    expect(isCopilotReviewer(author)).toBe(expected)
  })
})

describe('copilotReviewOn', () => {
  const HEAD = 'b'.repeat(40)
  const OLDER = 'a'.repeat(40)
  const copilot = {
    __typename: 'Bot',
    login: 'copilot-pull-request-reviewer',
    databaseId: 175728472,
  }
  const review = (
    extra: Partial<PullRequestReview> = {},
  ): PullRequestReview => ({
    state: 'COMMENTED',
    submittedAt: '2026-09-25T13:00:00Z',
    commit: { oid: HEAD },
    author: copilot,
    body: '## Pull request overview\n\nCopilot reviewed 3 out of 3 changed files in this pull request and generated 2 comments.',
    ...extra,
  })

  it('accepts a COMMENTED Copilot review of the head', () => {
    const only = review()
    expect(copilotReviewOn({ reviews: [only], headRefOid: HEAD })).toEqual({
      ok: true,
      review: only,
      latest: only,
      failed: false,
    })
  })

  it('accepts an APPROVED one', () => {
    expect(
      copilotReviewOn({
        reviews: [review({ state: 'APPROVED' })],
        headRefOid: HEAD,
      }).ok,
    ).toBe(true)
  })

  it.each(['DISMISSED', 'PENDING', 'CHANGES_REQUESTED', undefined, null])(
    'refuses a Copilot review of the head in state %s, and reports it as the latest',
    (state) => {
      const only = review({ state })
      expect(copilotReviewOn({ reviews: [only], headRefOid: HEAD })).toEqual({
        ok: false,
        review: null,
        latest: only,
        failed: false,
      })
    },
  )

  it.each([
    [
      'a User',
      {
        __typename: 'User',
        login: 'copilot-pull-request-reviewer',
        databaseId: 175728472,
      },
    ],
    [
      'an Organization',
      {
        __typename: 'Organization',
        login: 'copilot-pull-request-reviewer',
        databaseId: 175728472,
      },
    ],
    ['another Bot', { ...copilot, databaseId: 2 }],
    ['nobody', null],
  ])(
    'does not take a review by %s for Copilot’s, nor report it',
    (_, author) => {
      expect(
        copilotReviewOn({ reviews: [review({ author })], headRefOid: HEAD }),
      ).toEqual({ ok: false, review: null, latest: null, failed: false })
    },
  )

  it('refuses a review of an older commit, and reports it as the latest', () => {
    const older = review({ commit: { oid: OLDER } })
    expect(copilotReviewOn({ reviews: [older], headRefOid: HEAD })).toEqual({
      ok: false,
      review: null,
      latest: older,
      failed: false,
    })
  })

  it.each([
    ['no commit', { commit: null }],
    ['a commit without an oid', { commit: {} }],
  ])('refuses a review with %s', (_, extra) => {
    expect(
      copilotReviewOn({ reviews: [review(extra)], headRefOid: HEAD }).ok,
    ).toBe(false)
  })

  it.each([undefined, null, ''])(
    'refuses everything when the head is %j',
    (headRefOid) => {
      expect(
        copilotReviewOn({ reviews: [review({ commit: null })], headRefOid }).ok,
      ).toBe(false)
      expect(
        copilotReviewOn({
          reviews: [review({ commit: { oid: '' } })],
          headRefOid,
        }).ok,
      ).toBe(false)
    },
  )

  it('has nothing to report without reviews', () => {
    for (const reviews of [[], null, undefined])
      expect(copilotReviewOn({ reviews, headRefOid: HEAD })).toEqual({
        ok: false,
        review: null,
        latest: null,
        failed: false,
      })
  })

  it('picks the newest counting review of the head and the newest review overall', () => {
    const first = review({ submittedAt: '2026-09-25T13:00:00Z' })
    const second = review({ submittedAt: '2026-09-25T13:10:00Z' })
    const dismissed = review({
      state: 'DISMISSED',
      submittedAt: '2026-09-25T13:20:00Z',
    })
    const human = review({
      author: { __typename: 'User', login: 'geazioliveira' },
      submittedAt: '2026-09-25T13:30:00Z',
    })
    // Given out of order: the answer does not depend on it.
    expect(
      copilotReviewOn({
        reviews: [dismissed, second, human, first],
        headRefOid: HEAD,
      }),
    ).toEqual({ ok: true, review: second, latest: dismissed, failed: false })
  })

  it('reports the newest Copilot review when only an older commit was reviewed after the head', () => {
    const onHead = review({
      state: 'DISMISSED',
      submittedAt: '2026-09-25T13:00:00Z',
    })
    const later = review({
      commit: { oid: OLDER },
      submittedAt: '2026-09-25T13:10:00Z',
    })
    expect(
      copilotReviewOn({ reviews: [later, onHead], headRefOid: HEAD }),
    ).toEqual({ ok: false, review: null, latest: later, failed: false })
  })

  it('skips a null review node', () => {
    const only = review()
    expect(
      copilotReviewOn({ reviews: [null, only], headRefOid: HEAD }),
    ).toEqual({ ok: true, review: only, latest: only, failed: false })
  })

  // Measured on GitHub: a failed review is a COMMENTED review by the bot, on
  // the head, with one of these bodies (keycloak/keycloak#52793,
  // Azure/azure-powershell#30106, bsv-blockchain/teranode#1697 and
  // onnx/onnx#8217, microsoft/lisa#4700).
  const failures = [
    'Copilot encountered an error and was unable to review this pull request. You can try again by re-requesting a review.',
    "Copilot wasn't able to review any files in this pull request.\n\n\n\n",
    'Copilot was unable to review this pull request because the user who requested the review has reached their quota limit.',
    'Copilot was unable to review this pull request because there is no eligible user to bill for this review.',
    'Copilot was unable to review this pull request because the user who requested the review is ineligible.',
    'Copilot encountered an error: Your billing is not configured.',
  ]

  it.each(failures)(
    'refuses a failed review of the head, and reports it as the latest, failed: %j',
    (body) => {
      const failed = review({ body })
      expect(copilotReviewOn({ reviews: [failed], headRefOid: HEAD })).toEqual({
        ok: false,
        review: null,
        latest: failed,
        failed: true,
      })
    },
  )

  it.each([
    ['no body', undefined],
    ['a null body', null],
    ['an empty body', ''],
    ['a blank body', ' \n\t '],
  ])(
    'refuses a review of the head with %s, as a failure it cannot tell apart',
    (_, body) => {
      const unknown = review({ body })
      expect(copilotReviewOn({ reviews: [unknown], headRefOid: HEAD })).toEqual(
        { ok: false, review: null, latest: unknown, failed: true },
      )
    },
  )

  it('keeps an earlier good review of the head when a later one failed', () => {
    const good = review({ submittedAt: '2026-09-25T13:00:00Z' })
    const failed = review({
      body: failures[0],
      submittedAt: '2026-09-25T13:10:00Z',
    })
    expect(
      copilotReviewOn({ reviews: [failed, good], headRefOid: HEAD }),
    ).toEqual({ ok: true, review: good, latest: failed, failed: true })
  })

  it('reports a failed review of an older commit as failed', () => {
    const failed = review({ body: failures[1], commit: { oid: OLDER } })
    expect(copilotReviewOn({ reviews: [failed], headRefOid: HEAD })).toEqual({
      ok: false,
      review: null,
      latest: failed,
      failed: true,
    })
  })
})

describe('copilotFailedReview', () => {
  it.each([
    'Copilot encountered an error and was unable to review this pull request.',
    "Copilot wasn't able to review any files in this pull request.",
    'Copilot wasn’t able to review any files in this pull request.',
    'Copilot wasn‘t able to review',
    'Copilot wasnʼt able to review',
    'Copilot wasn`t able to review',
    'Copilot was not able to review any files in this pull request.',
    'COPILOT ENCOUNTERED AN ERROR',
    'copilot was not able to review',
    '\nCopilot encountered an error',
  ])('matches the start of a failed review: %j', (body) => {
    expect(copilotFailedReview.test(body)).toBe(true)
  })

  it.each([
    '## Pull request overview\n\nCopilot reviewed 3 out of 3 changed files in this pull request and generated 2 comments.',
    'Copilot reviewed 1 out of 1 changed files in this pull request and generated no comments.',
    '',
    'Note: Copilot encountered an error once, then reviewed this.',
    'Copilot wasnt able to review',
    'Copilot was able to review',
  ])(
    'does not match a review that reviewed, or text past its start: %j',
    (body) => {
      expect(copilotFailedReview.test(body)).toBe(false)
    },
  )
})

describe('the commands a message and the docs give', () => {
  it('dispatches the refresh on main, never on the ref it is run from', () => {
    // A workflow_dispatch runs the copy of the ref it names.
    expect(refreshPrCommand(14)).toBe(
      'gh workflow run issue-link-refresh.yml --ref main -f pr=14',
    )
  })

  it('renews the verdict with the gate in CI mode', () => {
    expect(gateCiCommand(14, 'feature/13-review-gate')).toBe(
      'node scripts/gate.mjs --pr 14 --branch feature/13-review-gate',
    )
  })

  it('quotes for the shell a branch or a PR a command would otherwise run as syntax', () => {
    expect(gateCiCommand(14, 'feature/1-$(touch pwned)')).toBe(
      "node scripts/gate.mjs --pr 14 --branch 'feature/1-$(touch pwned)'",
    )
    expect(gateCiCommand('14; id', 'feature/1-x')).toBe(
      "node scripts/gate.mjs --pr '14; id' --branch feature/1-x",
    )
    expect(copilotRequestCommand('1`id`')).toBe(
      "gh pr edit '1`id`' --add-reviewer @copilot",
    )
    expect(refreshPrCommand("1'x")).toBe(
      "gh workflow run issue-link-refresh.yml --ref main -f pr='1'\\''x'",
    )
  })
})

describe('shellWord', () => {
  it.each([
    ['feature/13-review-gate', 'feature/13-review-gate'],
    [14, '14'],
    ['a.b_c:d@e%f+g=h,i-j', 'a.b_c:d@e%f+g=h,i-j'],
    ['', "''"],
    ['a b', "'a b'"],
    ["a'b", "'a'\\''b'"],
    ['$(id)', "'$(id)'"],
    ['<n>', "'<n>'"],
    ['=ls', "'=ls'"],
    ['a=b', 'a=b'],
    // One character a shell reads as syntax, and nothing else that would
    // force the quoting, so each is pinned on its own; ! and ^ only some
    // shells read (history, the old pipe), and the quoting covers them too.
    ...[
      ';',
      '&',
      '|',
      '(',
      ')',
      '<',
      '>',
      '{',
      '}',
      '?',
      '[',
      ']',
      '!',
      '^',
    ].map((character) => [`a${character}b`, `'a${character}b'`] as const),
    ['~', "'~'"],
    ['*', "'*'"],
    ['#', "'#'"],
  ] as const)('shellWord(%j) is %s', (word, expected) => {
    expect(shellWord(word)).toBe(expected)
  })

  // What a person pastes is what a shell reads back: every word, however
  // hostile, comes back unchanged and runs nothing.
  it.each([
    'feature/13-review-gate',
    'feature/1-$(touch pwned)',
    'feature/1-`touch pwned`',
    'a;touch pwned',
    'a && touch pwned',
    'a | cat',
    "it's",
    "''",
    '"double"',
    'a\\b',
    'new\nline',
    'tab\there',
    '*',
    '~',
    '#comment',
    '!bang',
    '$HOME',
    '',
    '-n',
    'a;id',
    'a&id',
    'a|id',
    'a(b)',
    'a{b,c}',
    'a<b',
    'a>b',
    // Globs that match a file in the shell's directory, so a bare one would
    // come back as that file's name.
    'package.jso?',
    'package.jso[n]',
    'package.*',
  ])('a POSIX shell reads shellWord(%j) back unchanged', (word) => {
    // HOME is set, so a bare ~ expands under any sh (dash on CI included),
    // and the shell runs in the repository, where the globs above match.
    const run = spawnSync('sh', ['-c', `printf '%s' ${shellWord(word)}`], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: '/nonexistent-home' },
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(word)
  })
})

describe('copilotRequested', () => {
  const copilot = {
    __typename: 'Bot',
    login: 'copilot-pull-request-reviewer',
    databaseId: 175728472,
  }
  const person = { __typename: 'User', login: 'geazioliveira' }

  it.each([
    ['Copilot requested', [{ requestedReviewer: copilot }], true],
    [
      'Copilot among other reviewers',
      [
        { requestedReviewer: person },
        null,
        { requestedReviewer: null },
        { requestedReviewer: copilot },
      ],
      true,
    ],
    [
      'Copilot as GitHub gives it when only __typename and databaseId are asked',
      [{ requestedReviewer: { __typename: 'Bot', databaseId: 175728472 } }],
      true,
    ],
    ['only a person', [{ requestedReviewer: person }], false],
    [
      'a person with Copilot’s login',
      [
        {
          requestedReviewer: {
            __typename: 'User',
            login: 'copilot-pull-request-reviewer',
          },
        },
      ],
      false,
    ],
    [
      'an Organization named like Copilot, with its id',
      [{ requestedReviewer: { ...copilot, __typename: 'Organization' } }],
      false,
    ],
    [
      'another bot with Copilot’s login',
      [{ requestedReviewer: { ...copilot, databaseId: 1 } }],
      false,
    ],
    [
      'a Bot without its database id',
      [{ requestedReviewer: { __typename: 'Bot' } }],
      false,
    ],
    ['a team', [{ requestedReviewer: { __typename: 'Team' } }], false],
    ['a reviewer GitHub did not give', [{ requestedReviewer: null }], false],
    ['a request GitHub gave as null', [null], false],
    ['no request', [], false],
    ['requests GitHub did not give (null)', null, false],
    ['requests GitHub did not give (undefined)', undefined, false],
  ])('copilotRequested: %s is %s', (_, requests, expected) => {
    expect(copilotRequested(requests)).toBe(expected)
  })
})

describe('openThreads', () => {
  const thread = (extra: Partial<ReviewThread> = {}): ReviewThread => ({
    isResolved: false,
    isOutdated: false,
    path: 'scripts/gate.mjs',
    line: 1,
    comments: {
      nodes: [
        {
          url: 'https://github.com/o/r/pull/1#discussion_r1',
          author: { login: 'copilot-pull-request-reviewer' },
        },
      ],
    },
    ...extra,
  })

  it('keeps an unresolved thread, outdated or not, whoever opened it', () => {
    const open = thread()
    const outdated = thread({ isOutdated: true, line: null })
    const human = thread({
      comments: { nodes: [{ url: 'u', author: { login: 'geazioliveira' } }] },
    })
    const resolved = thread({ isResolved: true })
    const resolvedOutdated = thread({ isResolved: true, isOutdated: true })
    expect(
      openThreads([open, resolved, outdated, resolvedOutdated, human]),
    ).toEqual([open, outdated, human])
  })

  it.each([
    ['without isResolved', thread({ isResolved: undefined })],
    ['with isResolved null', thread({ isResolved: null })],
  ])('counts a thread %s as open', (_, unsure) => {
    expect(openThreads([unsure])).toEqual([unsure])
  })

  it('counts a null thread node as open', () => {
    expect(openThreads([null])).toEqual([null])
  })

  it('finds none in no threads', () => {
    for (const threads of [[], null, undefined])
      expect(openThreads(threads)).toEqual([])
  })
})

describe('the step ids and the declarations', () => {
  it('pins the gate’s step ids and their order', () => {
    // A step removed or renamed here is a change to every hook and CI reader.
    expect(stepIds).toEqual([
      'repo',
      'pr-base',
      'pr-closes',
      'pr-closes-only',
      'pr-first-line',
      'copilot-review',
      'review-threads',
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
    ])
  })

  it('declares a type for every export of loop-sections.mjs, and nothing else', () => {
    const declared = [
      ...readFileSync(
        path.join(root, 'scripts', 'loop-sections.d.mts'),
        'utf8',
      ).matchAll(/^export declare (?:const|function) (\w+)/gm),
    ].map((match) => match[1])
    expect([...declared].sort()).toEqual(Object.keys(loop).sort())
  })
})
