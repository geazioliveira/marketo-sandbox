import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  bugStatuses,
  contextKindOf,
  contextKinds,
  decisionStatuses,
  intentStatuses,
  isUntypedContextFile,
  knowledgeStatuses,
  repositoryFileUrl,
  untypedContextPaths,
} from '../../scripts/loop-sections.mjs'
import { cleanEnv } from '../support/clean-env'
import { exec, projectRoot } from '../support/temp-repo'

// Several cases run the checker as a process; with the hooks' specs (#5)
// spawning beside them, 5 s is too short under load, as in gate.spec.ts.
vi.setConfig({ testTimeout: 60_000 })

/**
 * scripts/check-context.mjs, run the way `npm run check:context` runs it: a
 * child process whose working directory is the tree under test. Each case
 * starts from the smallest tree that holds every kind of file the checker
 * reads, all valid, and breaks one thing, so each failing case must report
 * exactly the one problem it planted.
 */

const script = path.join(projectRoot, 'scripts', 'check-context.mjs')

/** Files to write, relative to the tree's root; null leaves a file out. */
type Tree = Record<string, string | null>

interface Run {
  status: number | null
  stdout: string
  stderr: string
  /** Each `- file:line: message` the checker listed, without the dash. */
  problems: string[]
}

const lines = (...text: string[]): string => `${text.join('\n')}\n`

/** A typed context file: its title, one section and the Status block. */
const typed = (title: string, status: string): string =>
  lines(
    `# ${title}`,
    '',
    '## Declaração de intenção',
    '',
    'Texto.',
    '',
    '## Status',
    '',
    '- **Criado**: 2026-09-25 (Fase: Intent), de um teste (#3)',
    `- **Status**: ${status}`,
  )

/** The decision index, one row per [file, status]: the table starts at line 5. */
const decisionIndex = (rows: [string, string][]): string =>
  lines(
    '# Registros de decisão (ADR)',
    '',
    'O [guia](../README.md#vocabulário-de-status) tem o vocabulário.',
    '',
    '| Decisão | Título | Status |',
    '| --- | --- | --- |',
    ...rows.map(
      ([file, status]) =>
        `| [${file.slice(0, 4)}](${file}) | Um título | ${status} |`,
    ),
  )

const validTree = (): Tree => ({
  'AGENTS.md': lines(
    '# Roteador',
    '',
    'Veja [o guia](context/README.md#vocabulário-de-status) e [o fluxo](docs/development/workflow.md#o-loop).',
  ),
  'CLAUDE.md': lines('@AGENTS.md'),
  // A PR body resolves a relative link against the PR's page, so the
  // template links to main on GitHub; the checker still holds that to the tree.
  '.github/pull_request_template.md': lines(
    'Closes #',
    '',
    `[O changelog](${repositoryFileUrl}context/evolution/changelog.md#changelog)`,
  ),
  'context/README.md': lines(
    '# Context',
    '',
    '## Vocabulário de status',
    '',
    '[Decisões](decisions/README.md), [intents](intent/) e [o changelog](evolution/changelog.md).',
  ),
  'context/intent/project-intent.md': typed(
    'Project intent: sandbox',
    'In Progress',
  ),
  'context/intent/feature-loop.md': typed('Feature: Loop', 'Completed'),
  'context/intent/bug-link.md': typed('Bug: Link', 'Resolved'),
  'context/decisions/0001-first.md': typed('ADR 0001: Primeira', 'Accepted'),
  'context/decisions/0002-second.md': typed('ADR 0002: Segunda', 'Proposed'),
  'context/decisions/README.md': decisionIndex([
    ['0001-first.md', 'Accepted'],
    ['0002-second.md', 'Proposed'],
  ]),
  'context/knowledge/patterns/gate.md': typed('Pattern: Gate', 'Active'),
  'context/knowledge/anti-patterns/double.md': typed(
    'Anti-pattern: Dublê',
    'Active',
  ),
  'context/knowledge/glossary.md': lines(
    '# Glossário',
    '',
    'Sem bloco Status, como os índices.',
  ),
  'context/evolution/changelog.md': lines(
    '# Changelog',
    '',
    '## 2026-09-25: Um check (#3)',
    '',
    '---',
    '',
    '## 2026-09-24: Um loop (#2, PR #10)',
  ),
  'docs/development/workflow.md': lines(
    '# Fluxo',
    '',
    '## O loop',
    '',
    '[Voltar](../../context/README.md)',
  ),
})

function problemsOf(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
}

/**
 * Writes the valid tree with `changes` over it into a fresh temp directory,
 * runs the checker there (or in `cwd` below it) and removes the directory.
 * GIT_CEILING_DIRECTORIES stops git at the temp directory, so a temp dir that
 * happens to sit inside a repository does not make that repository the root.
 */
async function check(
  changes: Tree = {},
  options: { git?: boolean; cwd?: string } = {},
): Promise<Run> {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'check-context-spec-')),
  )
  try {
    const dir = path.join(root, 'repo')
    mkdirSync(dir, { recursive: true })
    for (const [file, content] of Object.entries({
      ...validTree(),
      ...changes,
    })) {
      if (content === null) continue
      const target = path.join(dir, file)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
    const env = cleanEnv(root, { extra: { GIT_CEILING_DIRECTORIES: root } })
    if (options.git === true) {
      const init = await exec('git', ['init', '-q'], { cwd: dir, env })
      if (init.status !== 0) throw new Error(`git init falhou: ${init.stderr}`)
    }
    const run = await exec(process.execPath, [script], {
      cwd: path.join(dir, options.cwd ?? ''),
      env,
      timeout: 30_000,
    })
    return { ...run, problems: problemsOf(run.stderr) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** The run failed and listed exactly these problems, each matched from its start. */
function expectProblems(run: Run, ...expected: RegExp[]): void {
  expect(run.status, run.stdout + run.stderr).toBe(1)
  expect(run.problems, run.stderr).toHaveLength(expected.length)
  expected.forEach((pattern, index) =>
    expect(run.problems[index]).toMatch(pattern),
  )
}

describe('scripts/check-context.mjs', () => {
  it('passes the valid tree with a one-line summary', async () => {
    const run = await check()
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout.trim()).toBe(
      'check:context: nenhum problema em 15 arquivos: 10 links internos, 7 blocos Status, 2 decisões no índice e 2 entradas do changelog.',
    )
  })

  it('passes this repository', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'check-context-spec-'))
    try {
      const run = await exec(process.execPath, [script], {
        cwd: projectRoot,
        env: cleanEnv(root),
        timeout: 30_000,
      })
      expect(run.stdout + run.stderr).toMatch(/^check:context: nenhum problema/)
      expect(run.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists every problem, not only the first', async () => {
    const run = await check({
      'context/intent/feature-loop.md': typed('Feature: Loop', 'Done'),
      'context/evolution/changelog.md': lines('# Changelog', '', '## Solto'),
      'CLAUDE.md': lines('[x](nada.md)'),
    })
    expect(run.stderr).toMatch(/^check:context: 3 problemas\./)
    expectProblems(
      run,
      /^CLAUDE\.md:1: link quebrado/,
      /^context\/evolution\/changelog\.md:3: /,
      /^context\/intent\/feature-loop\.md:10: status "Done"/,
    )
  })

  describe('(a) relative links', () => {
    it.each<[string, string, RegExp]>([
      [
        'a file that does not exist',
        '[x](../../context/intent/feature-nada.md)',
        /^docs\/development\/workflow\.md:6: link quebrado: "\.\.\/\.\.\/context\/intent\/feature-nada\.md" aponta para context\/intent\/feature-nada\.md, que não existe/,
      ],
      [
        'a file that differs only in case, as GitHub would 404 it',
        '[x](../../context/readme.md)',
        /^docs\/development\/workflow\.md:6: link quebrado: .*context\/readme\.md/,
      ],
      [
        'a path that climbs above the root',
        '[x](../../../fora.md)',
        /^docs\/development\/workflow\.md:6: link quebrado: .* sai da raiz do repositório/,
      ],
      [
        'an empty target',
        '[x]()',
        /^docs\/development\/workflow\.md:6: link vazio/,
      ],
    ])('refuses a link to %s', async (_case, link, problem) => {
      const run = await check({
        'docs/development/workflow.md': lines(
          '# Fluxo',
          '',
          '## O loop',
          '',
          '[Voltar](../../context/README.md)',
          link,
        ),
      })
      expectProblems(run, problem)
    })

    it('refuses an anchor that no heading of the target generates', async () => {
      // GitHub keeps accented letters: the slug is vocabulário-de-status.
      const run = await check({
        'AGENTS.md': lines(
          '# Roteador',
          '',
          '[o guia](context/README.md#vocabulario-de-status)',
        ),
      })
      expectProblems(
        run,
        /^AGENTS\.md:3: âncora quebrada: "context\/README\.md#vocabulario-de-status"; nenhum título de context\/README\.md gera #vocabulario-de-status$/,
      )
    })

    it('accepts the anchors GitHub generates: accents, code, punctuation, encoding and repeats', async () => {
      const run = await check({
        'docs/development/workflow.md': lines(
          '# Fluxo',
          '',
          '## Comentários que o gate lê',
          '',
          '### O passo `stacked`',
          '',
          '## Pull requests e merge!',
          '',
          '## Uso',
          '',
          '## Uso',
          '',
          'Um título sublinhado',
          '====================',
          '',
          '<a id="explicita"></a>',
        ),
        'AGENTS.md': lines(
          '# Roteador',
          '',
          '[a](docs/development/workflow.md#comentários-que-o-gate-lê)',
          '[b](docs/development/workflow.md#o-passo-stacked)',
          '[c](docs/development/workflow.md#pull-requests-e-merge)',
          '[d](docs/development/workflow.md#uso-1)',
          '[e](docs/development/workflow.md#coment%C3%A1rios-que-o-gate-l%C3%AA)',
          '[f](docs/development/workflow.md#um-título-sublinhado)',
          '[g](docs/development/workflow.md#explicita)',
          '[h](/context/README.md#vocabulário-de-status "título")',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })

    it('accepts the anchor of a setext heading whose line starts like another block, or is all code', async () => {
      // CommonMark: `**Notas**`, `#5 …` and `-foo` are paragraphs, not
      // emphasis-only junk, a heading or a list item, so the underline makes
      // each a heading; so does it a line that is all code span.
      const run = await check({
        'docs/development/workflow.md': lines(
          '# Fluxo',
          '',
          '**Notas do dono**',
          '===',
          '',
          '#5 em espera',
          '---',
          '',
          '-fora',
          '---',
          '',
          '`stacked`',
          '---',
        ),
        'AGENTS.md': lines(
          '# Roteador',
          '',
          '[a](docs/development/workflow.md#notas-do-dono)',
          '[b](docs/development/workflow.md#5-em-espera)',
          '[c](docs/development/workflow.md#-fora)',
          '[d](docs/development/workflow.md#stacked)',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })

    it('ignores links inside fenced code, inline code and HTML comments', async () => {
      const run = await check({
        'CLAUDE.md': lines(
          '@AGENTS.md',
          '',
          '```markdown',
          '[exemplo](nada.md)',
          '```',
          '',
          '~~~',
          '[exemplo](nada.md)',
          '~~~',
          '',
          'Um template diz `[NNNN: <título>](NNNN-<slug>.md)` e ``[x](nada.md)``.',
          '',
          '<!-- [comentário](nada.md)',
          '[ainda comentário](nada.md) -->',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })

    it('ignores URLs and mailto', async () => {
      const run = await check({
        'CLAUDE.md': lines(
          '[a](https://github.com/geazioliveira/marketo-sandbox/blob/main/nada.md)',
          '[b](http://127.0.0.1:9) [c](mailto:alguem@example.invalid) [d](//example.com/x)',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })

    it('holds an anchor in the same file to that file’s own headings', async () => {
      const run = await check({
        'docs/development/workflow.md': lines(
          '# Fluxo',
          '',
          '## O loop',
          '',
          '[Voltar](../../context/README.md) e [o loop](#o-loop), [o topo](#).',
          '[Uma seção renomeada](#auditoria-de-main)',
        ),
      })
      expectProblems(
        run,
        /^docs\/development\/workflow\.md:6: âncora quebrada: "#auditoria-de-main"; nenhum título de docs\/development\/workflow\.md gera #auditoria-de-main$/,
      )
    })

    it('decodes HTML entities in a heading, as GitHub renders it, before the slug', async () => {
      // "A &amp; B" renders "A & B", and the & drops out: #a--b.
      const run = await check({
        'docs/development/workflow.md': lines(
          '# Fluxo',
          '',
          '## O loop',
          '',
          '## A &amp; B',
          '',
          '## Menor &lt;que&gt; &#233; &#xE9;',
          '',
          '## Código `&amp;`',
          '',
          '[Voltar](../../context/README.md) [a](#a--b) [b](#menor-que-é-é) [c](#código-amp)',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })

    it('reads a fence inside a blockquote as code, until the quote ends', async () => {
      const run = await check({
        'CLAUDE.md': lines(
          '@AGENTS.md',
          '',
          '> Um exemplo:',
          '>',
          '> ```markdown',
          '> [exemplo](nada.md)',
          '> ```',
          '',
          '> ```markdown',
          '> [exemplo](nada.md)',
          '',
          '[fora da citação, a cerca já fechou](nada.md)',
        ),
      })
      expectProblems(run, /^CLAUDE\.md:12: link quebrado: "nada\.md"/)
    })

    it('checks reference definitions, but not footnotes', async () => {
      const run = await check({
        'CLAUDE.md': lines('[guia][g]', '', '[g]: nada.md', '[^1]: Uma nota.'),
      })
      expectProblems(run, /^CLAUDE\.md:3: link quebrado: "nada\.md"/)
    })

    it('reads the PR template for links, and only for links', async () => {
      const run = await check({
        '.github/pull_request_template.md': lines(
          'Closes #',
          '',
          'Um exemplo de caminho: /Users/fulano/projeto',
          `[O changelog](${repositoryFileUrl}context/evolution/nada.md)`,
        ),
      })
      expectProblems(
        run,
        /^\.github\/pull_request_template\.md:4: link quebrado: "https:\/\/github\.com\/geazioliveira\/marketo-sandbox\/blob\/main\/context\/evolution\/nada\.md" aponta para context\/evolution\/nada\.md/,
      )
    })

    it('refuses a relative link in the PR template, which 404s in a PR body', async () => {
      // In a PR body a relative link resolves against /pull/<n>, not the tree.
      const run = await check({
        '.github/pull_request_template.md': lines(
          'Closes #',
          '',
          '## Risco',
          '',
          '[O changelog](../context/evolution/changelog.md) e [o risco](#risco).',
          `[Uma âncora de main](${repositoryFileUrl}context/README.md#nada)`,
        ),
      })
      expectProblems(
        run,
        new RegExp(
          `^\\.github/pull_request_template\\.md:5: link relativo num template que vira corpo de PR: "\\.\\./context/evolution/changelog\\.md"; .* Use ${repositoryFileUrl.replace(/[./]/g, '\\$&')}context/evolution/changelog\\.md, ou nenhum link$`,
        ),
        /^\.github\/pull_request_template\.md:6: âncora quebrada: .*nenhum título de context\/README\.md gera #nada$/,
      )
    })

    it('finds the root from a subdirectory with git, and treats ignored files as absent', async () => {
      // dist/ exists on the machine that built it and 404s on GitHub.
      const run = await check(
        {
          '.gitignore': lines('/dist'),
          'dist/main.js': lines('// build'),
          'docs/development/workflow.md': lines(
            '# Fluxo',
            '',
            '## O loop',
            '',
            '[Build](../../dist/main.js)',
            '[Não versionado, mas não ignorado](../../novo.md)',
          ),
          'novo.md': lines('# Novo'),
        },
        { git: true, cwd: 'docs' },
      )
      expectProblems(
        run,
        /^docs\/development\/workflow\.md:5: link quebrado: .*dist\/main\.js, que não existe no repositório \(ou é ignorado pelo git\)$/,
      )
    })
  })

  describe('(b) title and Status block of a typed context file', () => {
    it.each<[string, string, string, RegExp]>([
      [
        'a kind other than its folder asks for',
        'context/intent/feature-loop.md',
        '# Bug: Loop',
        /^context\/intent\/feature-loop\.md:1: o título declara "Bug", mas o caminho do arquivo pede "Feature"$/,
      ],
      [
        'a decision number other than its file name',
        'context/decisions/0001-first.md',
        '# ADR 0002: Primeira',
        /^context\/decisions\/0001-first\.md:1: o título declara "ADR 0002", mas o caminho do arquivo pede "ADR 0001"$/,
      ],
      [
        'no colon',
        'context/knowledge/patterns/gate.md',
        '# Pattern Gate',
        /^context\/knowledge\/patterns\/gate\.md:1: a primeira linha deve ser "# Pattern: <título>", com dois-pontos/,
      ],
      [
        'no title on the first line',
        'context/intent/project-intent.md',
        '',
        /^context\/intent\/project-intent\.md:1: a primeira linha deve ser "# Project intent: <título>"/,
      ],
    ])('refuses a title with %s', async (_case, file, title, problem) => {
      const body = (validTree()[file] ?? '').split('\n').slice(1).join('\n')
      const run = await check({ [file]: `${title}\n${body}` })
      expectProblems(run, problem)
    })

    it('refuses a file without a Status block, naming its last line', async () => {
      const run = await check({
        'context/knowledge/anti-patterns/double.md': lines(
          '# Anti-pattern: Dublê',
          '',
          '## Resumo',
          '',
          'Texto.',
        ),
      })
      expectProblems(
        run,
        /^context\/knowledge\/anti-patterns\/double\.md:5: sem bloco "## Status"/,
      )
    })

    it('refuses a second Status block', async () => {
      const run = await check({
        'context/intent/bug-link.md': `${typed('Bug: Link', 'Resolved')}\n## Status\n\n- **Status**: Resolved\n`,
      })
      expectProblems(
        run,
        /^context\/intent\/bug-link\.md:12: bloco "## Status" repetido \(o primeiro está na linha 7\)/,
      )
    })

    it('refuses a Status block without the Status line', async () => {
      const run = await check({
        'context/intent/bug-link.md': lines(
          '# Bug: Link',
          '',
          '## Status',
          '',
          '- **Criado**: 2026-09-25 (Fase: Intent) (#3)',
          '- Status: Resolved',
        ),
      })
      expectProblems(
        run,
        /^context\/intent\/bug-link\.md:3: o bloco Status não tem a linha "- \*\*Status\*\*: <valor>"$/,
      )
    })

    it('reads the Status block outside code only', async () => {
      // A pattern that shows the block in an example still has exactly one.
      const run = await check({
        'context/knowledge/patterns/gate.md': lines(
          '# Pattern: Gate',
          '',
          '```markdown',
          '## Status',
          '',
          '- **Status**: Qualquer coisa',
          '```',
          '',
          '## Status',
          '',
          '<!-- Antes de aceito:',
          '- **Status**: Draft',
          '-->',
          '- **Status**: Active <!-- desde a #3 -->',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })

    it('refuses a status declared outside the Status block', async () => {
      const run = await check({
        'context/intent/feature-loop.md': lines(
          '# Feature: Loop',
          '',
          '- **Status**: Draft',
          '',
          '## Declaração de intenção',
          '',
          '**Status:** Completed, na prática.',
          '',
          '## Status',
          '',
          '- **Status**: Completed',
        ),
      })
      expectProblems(
        run,
        /^context\/intent\/feature-loop\.md:3: status declarado fora do bloco Status \(linha 9\)/,
        /^context\/intent\/feature-loop\.md:7: status declarado fora do bloco Status \(linha 9\)/,
      )
    })

    it.each([
      ['in an ordered list', '1. **Status**: Deprecated'],
      [
        'in an ordered list closed by a parenthesis',
        '2) **Status**: Deprecated',
      ],
      ['in a blockquote', '> **Status**: Deprecated'],
      ['in a list in a blockquote', '> - **Status**: Deprecated'],
      ['in a blockquote in a list', '- > **Status**: Deprecated'],
      ['in a nested blockquote', '>> **Status**: Deprecated'],
      ['bold with underscores', '- __Status__: Deprecated'],
      ['bold with underscores, the colon inside', '__Status:__ Deprecated'],
      ['quoted, ordered and underscored', '> 1. __Status__: Deprecated'],
    ])(
      'refuses a status declared outside the Status block %s',
      async (_case, declaration) => {
        const run = await check({
          'context/intent/feature-loop.md': lines(
            '# Feature: Loop',
            '',
            '## Declaração de intenção',
            '',
            declaration,
            '',
            '## Status',
            '',
            '- **Status**: Completed',
          ),
        })
        expectProblems(
          run,
          /^context\/intent\/feature-loop\.md:5: status declarado fora do bloco Status \(linha 7\)/,
        )
      },
    )

    it('refuses a status declared in an ordered list inside the block', async () => {
      const run = await check({
        'context/intent/bug-link.md': `${typed('Bug: Link', 'Resolved')}1. **Status**: Deprecated\n`,
      })
      expectProblems(
        run,
        /^context\/intent\/bug-link\.md:11: linha de status fora do formato "- \*\*Status\*\*: <valor>": "1\. \*\*Status\*\*: Deprecated"$/,
      )
    })

    it.each([
      ['===', 'level 1'],
      ['---', 'level 2'],
    ])(
      'refuses a setext heading underlined with %s (%s) after the Status block',
      async (underline) => {
        const run = await check({
          'context/decisions/0001-first.md': lines(
            '# ADR 0001: Primeira',
            '',
            '## Status',
            '',
            '- **Status**: Accepted',
            '',
            'Resultados',
            underline.repeat(4),
            '',
            '- **Status**: Deprecated',
          ),
        })
        expectProblems(
          run,
          /^context\/decisions\/0001-first\.md:7: a seção "Resultados" vem depois do bloco Status \(linha 3\); o bloco Status é a última seção do arquivo$/,
          /^context\/decisions\/0001-first\.md:10: status declarado fora do bloco Status \(linha 3\)/,
        )
      },
    )

    // Each of these lines only starts like another block, so CommonMark reads
    // it as a paragraph, and the underline makes it a heading: a section after
    // the Status block, which must not pass as part of it.
    it.each([
      ['a line wholly in bold', '**Resultados**', '==='],
      ['a line wholly in emphasis', '_Resultados_', '---'],
      ['an issue reference', '#12 depois do Status', '---'],
      ['a dash with no space', '-resultados', '---'],
      ['a number with no space', '1)resultados', '---'],
      ['a line that is all code', '`resultados`', '==='],
    ])(
      'refuses %s underlined after the Status block as a section',
      async (_, text, underline) => {
        const run = await check({
          'context/decisions/0001-first.md': lines(
            '# ADR 0001: Primeira',
            '',
            '## Status',
            '',
            '- **Status**: Accepted',
            '',
            text,
            underline,
            '',
            '- **Status**: Deprecated',
          ),
        })
        const quoted = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        expectProblems(
          run,
          new RegExp(
            `^context/decisions/0001-first\\.md:7: a seção "${quoted}" vem depois do bloco Status \\(linha 3\\); o bloco Status é a última seção do arquivo$`,
          ),
          /^context\/decisions\/0001-first\.md:10: status declarado fora do bloco Status \(linha 3\)/,
        )
      },
    )

    it.each(['#', '##'])(
      'refuses an empty %s heading after the Status block as a section',
      async (heading) => {
        const run = await check({
          'context/decisions/0001-first.md': lines(
            '# ADR 0001: Primeira',
            '',
            '## Status',
            '',
            '- **Status**: Accepted',
            '',
            heading,
            '',
            '- **Status**: Deprecated',
          ),
        })
        expectProblems(
          run,
          new RegExp(
            `^context/decisions/0001-first\\.md:7: a seção "${heading}" vem depois do bloco Status \\(linha 3\\)`,
          ),
          /^context\/decisions\/0001-first\.md:9: status declarado fora do bloco Status \(linha 3\)/,
        )
      },
    )

    it('reads a thematic break, a quote, a comment or an empty list item over `---` as no section', async () => {
      // Each opens a block of its own, so the `---` under it is a thematic
      // break, not a setext underline.
      const run = await check({
        'context/decisions/0001-first.md': lines(
          '# ADR 0001: Primeira',
          '',
          '## Status',
          '',
          '- **Status**: Accepted',
          '',
          '***',
          '---',
          '',
          '> Uma citação.',
          '---',
          '',
          '<!-- uma nota -->',
          '---',
          '',
          '2026.',
          '---',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })

    it('reads a rule or a list line over `---` in the Status block as no section', async () => {
      // A `---` after a blank line is a thematic break, and one right under a
      // list item is no setext underline: neither opens a section.
      const run = await check({
        'context/decisions/0001-first.md': lines(
          '# ADR 0001: Primeira',
          '',
          '## Status',
          '',
          '- **Criado**: 2026-09-25 (Fase: Intent), de um teste (#3)',
          '---',
          '- **Status**: Accepted',
          '',
          '---',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })

    it('refuses a status line of another shape inside the block', async () => {
      const run = await check({
        'context/intent/bug-link.md': `${typed('Bug: Link', 'Resolved')}  - **Status**: Deprecated\n`,
      })
      expectProblems(
        run,
        /^context\/intent\/bug-link\.md:11: linha de status fora do formato "- \*\*Status\*\*: <valor>": "- \*\*Status\*\*: Deprecated"$/,
      )
    })

    // Inside a comment carried in from an earlier line, the line is raw HTML:
    // its `-->` closes the comment even between backticks, and the heading
    // after it is a real section (GitHub renders `<h2>Depois</h2>`).
    it('closes a comment at a `-->` inside backticks and reads the heading after it', async () => {
      const run = await check({
        'context/decisions/0001-first.md': lines(
          '# ADR 0001: Primeira',
          '',
          '## Status',
          '',
          '- **Status**: Accepted',
          '',
          '<!--',
          'comentário com `-->` no meio',
          '## Depois',
          '-->',
        ),
      })
      expectProblems(
        run,
        /^context\/decisions\/0001-first\.md:9: a seção "## Depois" vem depois do bloco Status \(linha 3\); o bloco Status é a última seção do arquivo$/,
      )
    })

    it('refuses a section after the Status block, and a status declared in it', async () => {
      const run = await check({
        'context/decisions/0001-first.md': lines(
          '# ADR 0001: Primeira',
          '',
          '## Status',
          '',
          '- **Status**: Accepted',
          '',
          '## Resultados',
          '',
          '- **Status**: Deprecated',
        ),
      })
      expectProblems(
        run,
        /^context\/decisions\/0001-first\.md:7: a seção "## Resultados" vem depois do bloco Status \(linha 3\); o bloco Status é a última seção do arquivo$/,
        /^context\/decisions\/0001-first\.md:9: status declarado fora do bloco Status \(linha 3\)/,
      )
    })

    it.each([
      [
        'context/intent/project-intent.md',
        'Project intent: sandbox',
        'Resolved',
      ],
      ['context/intent/feature-loop.md', 'Feature: Loop', 'Resolved'],
      ['context/intent/bug-link.md', 'Bug: Link', 'Completed'],
      ['context/decisions/0001-first.md', 'ADR 0001: Primeira', 'Active'],
      ['context/knowledge/patterns/gate.md', 'Pattern: Gate', 'Accepted'],
      [
        'context/knowledge/anti-patterns/double.md',
        'Anti-pattern: Dublê',
        'In Progress',
      ],
    ])(
      'refuses in %s a status of another kind',
      async (file, title, status) => {
        const run = await check({ [file]: typed(title, status) })
        const kind = title.replace(/(?: \d{4})?:.*$/, '')
        expectProblems(
          run,
          new RegExp(
            `^${file.replace(/[.]/g, '\\.')}:10: status "${status}" não vale para ${kind}; use `,
          ),
        )
      },
    )

    it.each([
      ['context/intent/notes.md', typed('Feature: Notas', 'Draft')],
      ['context/agents/notes.md', typed('Agent: Notas', 'Active')],
      ['context/notes.md', lines('# Notas')],
      ['context/evolution/history/2026/janeiro.md', lines('# Janeiro')],
      ['context/knowledge/diagram.png', 'png'],
    ])('refuses %s, outside the layout', async (file, content) => {
      const run = await check({ [file]: content })
      expectProblems(
        run,
        new RegExp(
          `^${file.replace(/[.]/g, '\\.')}:1: arquivo fora do layout do Context Mesh: em context/ ficam, com tipo, .*agents/agent-<nome>\\.md; sem tipo, README\\.md \\(índice, em qualquer pasta\\)`,
        ),
      )
    })

    it.each([false, true])(
      'leaves hidden non-markdown files under context/ out of the layout (git: %s)',
      async (git) => {
        // Finder writes .DS_Store into every folder it opens, and Obsidian
        // keeps .obsidian/ in a folder opened as a vault: neither is content.
        const run = await check(
          {
            'context/.DS_Store': 'finder',
            'context/knowledge/.DS_Store': 'finder',
            'context/.obsidian/workspace.json': '{}',
          },
          { git },
        )
        expect(run.stdout + run.stderr).toMatch(
          /nenhum problema em 15 arquivos/,
        )
        expect(run.status).toBe(0)
      },
    )

    it('still refuses a visible non-markdown file beside a hidden one', async () => {
      const run = await check({
        'context/.obsidian/workspace.json': '{}',
        'context/knowledge/notes.txt': 'texto',
      })
      expectProblems(
        run,
        /^context\/knowledge\/notes\.txt:1: arquivo fora do layout do Context Mesh/,
      )
    })

    it('the repository ignores .DS_Store itself, without a global ignore', async () => {
      // cleanEnv replaces HOME and XDG_CONFIG_HOME, so no global excludes
      // file is read: only the repository's own .gitignore can match.
      const root = mkdtempSync(path.join(tmpdir(), 'check-context-spec-'))
      try {
        const env = cleanEnv(root)
        for (const file of ['.DS_Store', 'context/knowledge/.DS_Store']) {
          const run = await exec(
            'git',
            ['check-ignore', '--no-index', '--quiet', file],
            { cwd: projectRoot, env },
          )
          expect(run.status, `${file}: ${run.stderr}`).toBe(0)
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('accepts an agent, every folder index, and evolution’s history and learning notes', async () => {
      const run = await check({
        'context/agents/agent-reviewer.md': typed('Agent: Revisor', 'Active'),
        'context/agents/README.md': lines('# Agentes', '', 'Nenhum ainda.'),
        'context/knowledge/patterns/README.md': lines('# Patterns'),
        'context/intent/README.md': lines('# Intents'),
        'context/evolution/history/2026.md': lines('# 2026', '', 'Arquivado.'),
        'context/evolution/learning-gate.md': lines('# O que o gate ensinou'),
      })
      expect(run.stdout + run.stderr).toMatch(
        /^check:context: nenhum problema em 21 arquivos: 10 links internos, 8 blocos Status,/,
      )
      expect(run.status).toBe(0)
    })

    it('holds an agent to its title and to the pattern statuses', async () => {
      const run = await check({
        'context/agents/agent-reviewer.md': typed(
          'Pattern: Revisor',
          'Accepted',
        ),
      })
      expectProblems(
        run,
        /^context\/agents\/agent-reviewer\.md:1: o título declara "Pattern", mas o caminho do arquivo pede "Agent"$/,
        /^context\/agents\/agent-reviewer\.md:10: status "Accepted" não vale para Agent; use "Active", "Superseded" ou "Deprecated"$/,
      )
    })
  })

  describe('(c) the decision index', () => {
    it('refuses a row whose status differs from the file', async () => {
      const run = await check({
        'context/decisions/README.md': decisionIndex([
          ['0001-first.md', 'Accepted'],
          ['0002-second.md', 'Accepted'],
        ]),
      })
      expectProblems(
        run,
        /^context\/decisions\/README\.md:8: o índice diz "Accepted" para 0002-second\.md, mas o arquivo diz "Proposed"$/,
      )
    })

    it('refuses a decision with no row', async () => {
      const run = await check({
        'context/decisions/0003-third.md': typed(
          'ADR 0003: Terceira',
          'Accepted',
        ),
      })
      expectProblems(
        run,
        /^context\/decisions\/README\.md:5: a decisão 0003-third\.md não tem linha na tabela do índice$/,
      )
    })

    it('refuses a decision listed twice', async () => {
      const run = await check({
        'context/decisions/README.md': decisionIndex([
          ['0001-first.md', 'Accepted'],
          ['0002-second.md', 'Proposed'],
          ['0001-first.md', 'Accepted'],
        ]),
      })
      expectProblems(
        run,
        /^context\/decisions\/README\.md:9: a decisão 0001-first\.md aparece em mais de uma linha do índice \(a primeira é a linha 7\)/,
      )
    })
  })

  describe('(d) changelog headings', () => {
    it.each([
      '## 2026-09-25: Sem issue',
      '## 2026-9-25: Data curta (#3)',
      '## Um check (#3)',
      '## 2026-09-25: Só a PR (PR #10)',
      '## 2026-09-25: A PR antes da issue (PR #10, #3)',
    ])('refuses %j', async (heading) => {
      const run = await check({
        'context/evolution/changelog.md': lines(
          '# Changelog',
          '',
          '## 2026-09-25: Um check (#3)',
          '',
          heading,
        ),
      })
      expectProblems(
        run,
        /^context\/evolution\/changelog\.md:5: título de entrada fora do formato/,
      )
    })

    it('reads the headings outside code only', async () => {
      const run = await check({
        'context/evolution/changelog.md': lines(
          '# Changelog',
          '',
          '```markdown',
          '## AAAA-MM-DD: <o que mudou> (#issue)',
          '```',
          '',
          '### Uma subseção de entrada',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })
  })

  describe('(e) machine paths', () => {
    it.each([
      '/Users/fulano/projeto/arquivo.md',
      '/Volumes/Extension 03/Projects',
      '/home/runner/work/marketo-sandbox',
      '/private/tmp/claude-501/scratchpad',
      '/private/var/folders/xy/T/check-context-spec-abc',
      '/var/folders/xy/T/check-context-spec-abc',
      '/tmp/claude-501/scratchpad',
      'C:\\Users\\fulano\\projeto',
    ])('refuses %j, in prose or in code', async (machinePath) => {
      const run = await check({
        'context/intent/feature-loop.md': `${typed('Feature: Loop', 'Completed')}\nRodado em ${machinePath}.\n`,
        'docs/development/workflow.md': lines(
          '# Fluxo',
          '',
          '## O loop',
          '',
          '```sh',
          `cd ${machinePath}`,
          '```',
        ),
      })
      const [start] = machinePath.split(' ')
      const shown = start.replace(/[\\.]/g, '\\$&')
      expectProblems(
        run,
        new RegExp(
          `^context/intent/feature-loop\\.md:12: caminho absoluto de máquina "${shown}`,
        ),
        new RegExp(
          `^docs/development/workflow\\.md:6: caminho absoluto de máquina "${shown}`,
        ),
      )
    })

    it('accepts the bare prefixes that name the rule, and URLs', async () => {
      const run = await check({
        'CLAUDE.md': lines(
          'Nada de caminho de máquina (`/Users/`, `/Volumes/`, `/private/tmp/`, `/home/<x>/`).',
          'Nem `/private/var/`, `/var/folders/`, `/tmp/<x>/` ou /tmp/ soltos.',
          'Nem /Users/ solto, nem https://example.com/Users/fulano/x, nem https://example.com/tmp/x/y.',
        ),
      })
      expect(run.stdout + run.stderr).toMatch(/nenhum problema/)
      expect(run.status).toBe(0)
    })
  })
})

describe('the context vocabularies in scripts/loop-sections.mjs', () => {
  it.each([
    ['intent/project-intent.md', 'Project intent'],
    ['intent/feature-issue-first-loop.md', 'Feature'],
    ['intent/bug-link.md', 'Bug'],
    ['decisions/0002-soft-enforcement-on-github-free.md', 'ADR 0002'],
    ['knowledge/patterns/loop-gate.md', 'Pattern'],
    ['knowledge/anti-patterns/test-double.md', 'Anti-pattern'],
    ['agents/agent-reviewer.md', 'Agent'],
  ])('gives %s the title kind %s', (file, title) => {
    expect(contextKindOf(file)?.title).toBe(title)
  })

  it.each([
    'README.md',
    'decisions/README.md',
    'knowledge/patterns/README.md',
    'knowledge/glossary.md',
    'evolution/changelog.md',
    'evolution/history/2026.md',
    'evolution/learning-gate.md',
  ])('gives %s no kind, as an untyped file', (file) => {
    expect(contextKindOf(file)).toBeNull()
    expect(isUntypedContextFile(file)).toBe(true)
  })

  it.each([
    'intent/notes.md',
    'decisions/12-short.md',
    'knowledge/patterns/nested/x.md',
    'agents/notes.md',
    'notes.md',
    'evolution/history/2026/janeiro.md',
    'knowledge/README.md.bak',
  ])('gives %s no kind, and does not exempt it', (file) => {
    expect(contextKindOf(file)).toBeNull()
    expect(isUntypedContextFile(file)).toBe(false)
  })

  it('match the status table of the Context Mesh guide', () => {
    // context/README.md restates the vocabulary for people; the two must not drift.
    const guide = readFileSync(
      path.join(projectRoot, 'context', 'README.md'),
      'utf8',
    )
    const [, section = ''] = guide.split('\n## Vocabulário de status\n')
    const rows = section
      .split('\n## ')[0]
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .slice(2)
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .map(([, label, tokens]): [string, string[]] => [
        label,
        [...tokens.matchAll(/`([^`]+)`/g)].map((token) => token[1]),
      ])
    expect(rows).toHaveLength(4)
    expect(Object.fromEntries(rows)).toEqual({
      'Project intent ou feature': [...intentStatuses],
      Bug: [...bugStatuses],
      Decisão: [...decisionStatuses],
      'Pattern, anti-pattern ou agente': [...knowledgeStatuses],
    })
  })

  it('name every path shape the Layout of the Context Mesh guide lists', () => {
    // A folder the guide promises and the checker refuses turns npm run check
    // red on its first file; one the checker accepts and the guide omits is a
    // rule nobody reads.
    const guide = readFileSync(
      path.join(projectRoot, 'context', 'README.md'),
      'utf8',
    )
    const [, section = ''] = guide.split('\n## Layout\n')
    const layout = section.split('\n## ')[0]
    const shapes = [...contextKinds, ...untypedContextPaths].map(
      ({ shape }) => shape,
    )
    for (const shape of shapes) expect(layout).toContain(`\`${shape}\``)
    expect(layout).toContain(
      'um arquivo fora destas pastas faz o check:context recusar',
    )
  })

  it('end every typed template of the Context Mesh guide with the Status block it defines', () => {
    // The checker refuses a typed file without the block, so a template
    // copied as it stands must already carry it; the changelog entry has none.
    const guide = readFileSync(
      path.join(projectRoot, 'context', 'README.md'),
      'utf8',
    )
    const fenced = (text: string): string[] =>
      [...text.matchAll(/^```markdown\n([\s\S]*?)^```$/gm)].map(
        (match) => match[1],
      )
    // Split by the section headings only: the sketch itself opens with `## Status`.
    const [, afterBlock = ''] = guide.split('\n## O bloco Status\n')
    const [blockSection, templates = ''] = afterBlock.split('\n## Templates\n')
    const [block] = fenced(blockSection)
    expect(block).toMatch(/^## Status\n\n- \*\*Criado\*\*: /)
    const kinds: string[] = contextKinds.map(({ kind }) => kind)
    const typedTemplates = new Map<string, string>()
    let changelogEntries = 0
    for (const template of fenced(templates)) {
      const title = /^# ([^:]+?)(?: NNNN)?: /.exec(template)
      if (title !== null && kinds.includes(title[1])) {
        typedTemplates.set(title[1], template)
        expect(template.endsWith(`\n\n${block}`), title[1]).toBe(true)
        expect(template.match(/^## Status$/gm), title[1]).toHaveLength(1)
      } else {
        expect(template, template).toMatch(/^## AAAA-MM-DD: /)
        expect(template).not.toMatch(/^## Status$/m)
        changelogEntries += 1
      }
    }
    expect([...typedTemplates.keys()].sort()).toEqual([...kinds].sort())
    expect(changelogEntries).toBe(1)
  })

  it('name every title kind the Context Mesh guide shows', () => {
    const guide = readFileSync(
      path.join(projectRoot, 'context', 'README.md'),
      'utf8',
    )
    for (const { kind } of contextKinds)
      expect(guide).toContain(`\`# ${kind === 'ADR' ? 'ADR 0001' : kind}: `)
  })
})
