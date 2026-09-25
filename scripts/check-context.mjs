#!/usr/bin/env node
// The context checker (#3): holds context/, the router and the docs to the
// formats context/README.md states, so a broken link or a stale status fails
// `npm run check` instead of waiting for a reader to trip on it.
//
// What it refuses, each problem named with file:line:
// (a) a relative markdown link whose target is not in the repository, or whose
//     #anchor no heading of the target generates (GitHub's slug rules); a
//     same-file #anchor is held to the file's own headings. In the PR
//     template, which becomes a PR body, any relative link at all: there it
//     resolves against the PR's page and 404s, so the template links to
//     repositoryFileUrl, and those links are checked like relative ones;
// (b) a file under context/ outside the layout (contextKinds and
//     untypedContextPaths), hidden non-markdown files (.DS_Store, .obsidian/)
//     aside; a typed file whose first line is not `# <Kind>: <título>` for
//     its folder, or that lacks exactly one `## Status` block, as its last
//     section (no ATX or setext heading after it), with one status line valid
//     for its kind and no status declared anywhere else (statusDeclaration);
// (c) a decision missing from context/decisions/README.md, listed twice, or
//     listed with a status other than the one its file declares;
// (d) a changelog `## ` line outside changelogHeading;
// (e) an absolute machine path, which resolves only on the machine that wrote it.
//
// Every format comes from scripts/loop-sections.mjs, never from a copy here:
// a rule restated in a second place drifts (see the header of that file).
// No dependencies, so it runs anywhere Node runs, before `npm ci` included.
//
// The markdown reader is a small one, not CommonMark. What it does not see,
// each measured on a scratch file:
// - a link in an `<a href>` or an `<img src>`, and an autolink, are never
//   checked; neither is a reference definition inside a blockquote or a list,
//   nor a link whose text or target spans two lines;
// - a heading inside a blockquote or a list item generates no anchor here, so
//   a link to it is reported as a broken anchor;
// - a setext underline is read against the one line above it. A list item's
//   continuation line over `---` is taken for a heading, though CommonMark
//   makes that `---` a thematic break, so the Status block refuses it as a
//   section; an ordered item numbered other than 1 right under a paragraph
//   line is taken for a list item, though CommonMark continues the paragraph;
//   and a table row (`| … |`) over an underline is never taken for a heading;
// - an indented code block (four spaces) is read as prose, so a link in it is
//   checked;
// - of the named HTML entities in a heading, only &amp; &lt; &gt; &quot;
//   &apos; and &nbsp; are decoded (numeric ones all are);
// - a link with a query, such as `x.md?plain=1#L3`, has its anchor held to
//   the headings, so a line anchor is reported as broken;
// - the machine paths are the prefixes machinePath lists: `/home/<user>`
//   without a trailing slash, and a drive letter written with `/`, pass.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  changelogHeading,
  contextKinds,
  contextKindOf,
  isUntypedContextFile,
  repositoryFileUrl,
  statusDeclaration,
  statusHeading,
  statusLine,
  untypedContextPaths,
} from './loop-sections.mjs'

const changelogFile = 'context/evolution/changelog.md'
const decisionIndex = 'context/decisions/README.md'
/**
 * Scanned for links only: its prose is a template, not a document. It becomes
 * a PR body, so its links must be absolute (repositoryFileUrl).
 */
const linksOnlyFiles = ['.github/pull_request_template.md']
/** Never walked when there is no git to say what the repository holds. */
const skippedDirectories = new Set(['.git', 'node_modules'])

// ---------------------------------------------------------------------------
// The repository

/**
 * The repository root and whether git can list its files. The git toplevel
 * wins over the working directory, so the checker gives the same verdict from
 * any subdirectory; outside a repository the working directory is the root.
 */
function locate(cwd) {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (root !== '') return { root, git: true }
  } catch {
    // No repository here, or no git at all: fall through to the directory.
  }
  return { root: cwd, git: false }
}

/**
 * Every file the repository holds, relative to the root with `/` separators.
 * With git: tracked and untracked files, ignored ones left out, because a link
 * to dist/ or node_modules/ resolves on this machine and 404s on GitHub. The
 * names come as git stores them, so a link that differs only in case fails
 * here on a case-insensitive disk too, as it would on GitHub.
 */
function listFiles({ root, git }) {
  if (git) {
    try {
      return execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 256 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      )
        .split('\0')
        .filter((file) => file !== '')
    } catch {
      // A broken index: the walk below still gives a verdict.
    }
  }
  const found = []
  const walk = (directory) => {
    const entries = readdirSync(path.join(root, directory), {
      withFileTypes: true,
    })
    for (const entry of entries) {
      const relative =
        directory === '' ? entry.name : `${directory}/${entry.name}`
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) walk(relative)
      } else found.push(relative)
    }
  }
  walk('')
  return found
}

/** Whether a path is a dotfile or lies in a dot-directory (`.DS_Store`, `.obsidian/…`). */
const isHidden = (file) => file.split('/').some((part) => part.startsWith('.'))

/** The directories that hold at least one file, the root included as ''. */
function directoriesOf(files) {
  const directories = new Set([''])
  for (const file of files) {
    let at = path.posix.dirname(file)
    while (at !== '.' && !directories.has(at)) {
      directories.add(at)
      at = path.posix.dirname(at)
    }
  }
  return directories
}

// ---------------------------------------------------------------------------
// Markdown, as far as the checks need it

/**
 * A line split into code spans and the text around them. A run of n
 * backticks opens a span that only a run of exactly n backticks closes; an
 * unmatched run is literal text (CommonMark).
 * @returns {{ code: boolean, raw: string, content: string }[]}
 */
function splitCodeSpans(line) {
  const runs = [...line.matchAll(/`+/g)].map((run) => ({
    at: run.index,
    size: run[0].length,
  }))
  const parts = []
  let position = 0
  let index = 0
  while (index < runs.length) {
    const open = runs[index]
    const closeIndex = runs.findIndex(
      (run, later) => later > index && run.size === open.size,
    )
    if (closeIndex < 0) {
      index += 1
      continue
    }
    const close = runs[closeIndex]
    const end = close.at + close.size
    if (open.at > position) {
      const raw = line.slice(position, open.at)
      parts.push({ code: false, raw, content: raw })
    }
    parts.push({
      code: true,
      raw: line.slice(open.at, end),
      content: line.slice(open.at + open.size, close.at).trim(),
    })
    position = end
    index = closeIndex + 1
  }
  if (position < line.length) {
    const raw = line.slice(position)
    parts.push({ code: false, raw, content: raw })
  }
  return parts
}

/** HTML comments blanked out, the state carried across lines. */
function maskComments(line, inside) {
  let text = ''
  let rest = line
  let comment = inside
  while (rest !== '') {
    if (comment) {
      const end = rest.indexOf('-->')
      if (end < 0) {
        text += ' '.repeat(rest.length)
        rest = ''
      } else {
        text += ' '.repeat(end + 3)
        rest = rest.slice(end + 3)
        comment = false
      }
    } else {
      const start = rest.indexOf('<!--')
      if (start < 0) {
        text += rest
        rest = ''
      } else {
        text += `${rest.slice(0, start)}    `
        rest = rest.slice(start + 4)
        comment = true
      }
    }
  }
  return { text, comment }
}

/**
 * A line's blockquote markers (`>`), at most `limit` of them, taken off: the
 * quote depth and the rest of the line.
 */
function unquote(line, limit = Infinity) {
  let rest = line
  let depth = 0
  while (depth < limit) {
    const marker = /^ {0,3}>[ \t]?/.exec(rest)
    if (marker === null) break
    depth += 1
    rest = rest.slice(marker[0].length)
  }
  return { depth, rest }
}

/**
 * The file's lines, and for each one its prose: the line with code spans and
 * HTML comments blanked to spaces (so columns and pipes stay where they were),
 * or null for a line of a fenced code block, fences included. Links, headings
 * and statuses are read from the prose only: what sits in code is an example,
 * not a claim. A fence inside a blockquote counts too, and ends where the
 * quote ends, closed or not (CommonMark). `shown` says, for each line, whether
 * it shows any text outside HTML comments, its code spans included: a line
 * that is all code span, such as `` `notas` ``, is blank prose but still the
 * text of a heading when `===` or `---` underlines it.
 * @returns {{ lines: string[], prose: (string | null)[], shown: boolean[] }}
 */
function readMarkdown(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const prose = []
  const shown = []
  let fence = null
  let comment = false
  for (const line of lines) {
    if (fence !== null) {
      const { depth, rest } = unquote(line, fence.depth)
      if (depth < fence.depth) fence = null
      else {
        const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(rest)
        if (
          close !== null &&
          close[1][0] === fence.char &&
          close[1].length >= fence.size
        )
          fence = null
        prose.push(null)
        shown.push(false)
        continue
      }
    }
    const quoted = unquote(line)
    const open = comment ? null : /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(quoted.rest)
    // A backtick fence's info string cannot hold a backtick; that is inline code.
    if (open !== null && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { char: open[1][0], size: open[1].length, depth: quoted.depth }
      prose.push(null)
      shown.push(false)
      continue
    }
    // A comment carried in from an earlier line makes this line raw HTML:
    // markdown is not parsed there, so its first `-->` closes the comment even
    // between backticks (GitHub renders it so). Only the rest of the line is
    // read for code spans.
    let head = ''
    let body = line
    if (comment) {
      const end = line.indexOf('-->')
      if (end < 0) {
        prose.push(' '.repeat(line.length))
        shown.push(false)
        continue
      }
      head = ' '.repeat(end + 3)
      body = line.slice(end + 3)
      comment = false
    }
    const parts = splitCodeSpans(body)
    const masked = maskComments(
      parts
        .map((part) => (part.code ? ' '.repeat(part.raw.length) : part.raw))
        .join(''),
      false,
    )
    // The same masking with each code span kept as a mark, which can open or
    // close no comment: what is left is what the line shows.
    const marked = maskComments(
      parts
        .map((part) => (part.code ? 'x'.repeat(part.raw.length) : part.raw))
        .join(''),
      false,
    )
    comment = masked.comment
    prose.push(head + masked.text)
    shown.push(marked.text.trim() !== '')
  }
  return { lines, prose, shown }
}

const atxHeading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const setextUnderline = /^ {0,3}(?:=+|-+)[ \t]*$/
/**
 * A line that opens some other block, so a `===` or `---` under it is no
 * setext underline: a list item (its marker followed by a space, a tab or the
 * end of the line), a blockquote, an ATX heading (the `#`s followed the same
 * way), a table row or a thematic break. A line that only starts with one of
 * those characters is a paragraph, and the underline makes it a heading:
 * `**Notas**`, `_Notas_`, `#5`, `-foo` and `1)x` all are (CommonMark).
 */
const otherBlock =
  /^ {0,3}(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|>|#{1,6}(?:[ \t]|$)|\||([-*_])(?:[ \t]*\1){2,}[ \t]*$)/

/**
 * Whether line `index` is a setext heading's text: a line that shows text,
 * code spans included, and that the next line underlines with `===` (level 1)
 * or `---` (level 2).
 */
function isSetextHeading({ lines, prose, shown }, index) {
  const text = prose[index]
  const under = prose[index + 1]
  return (
    text !== null &&
    text !== undefined &&
    shown[index] === true &&
    under !== null &&
    under !== undefined &&
    under.trim() !== '' &&
    setextUnderline.test(lines[index + 1]) &&
    !otherBlock.test(lines[index]) &&
    !setextUnderline.test(lines[index])
  )
}

/** The named entities decodeEntities knows; any other stays as written. */
const namedEntities = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** HTML entities as GitHub renders them: `A &amp; B` reads `A & B`. */
function decodeEntities(text) {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z][A-Za-z\d]*));/g,
    (entity, decimal, hex, name) => {
      if (name !== undefined)
        return Object.hasOwn(namedEntities, name) ? namedEntities[name] : entity
      const code = decimal !== undefined ? Number(decimal) : parseInt(hex, 16)
      // CommonMark: zero, a surrogate or past Unicode is the replacement character.
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
        ? '�'
        : String.fromCodePoint(code)
    },
  )
}

/** A heading's text as GitHub renders it: link targets, HTML and emphasis gone, entities decoded. */
function renderedText(heading) {
  return splitCodeSpans(heading)
    .map((part) =>
      part.code
        ? part.content
        : decodeEntities(
            part.raw
              .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
              .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
              .replace(/<[^>]*>/g, ''),
          )
            .replace(/\\(.)/g, '$1')
            // `_x_` is emphasis; the underscore in snake_case is a letter.
            .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1'),
    )
    .join('')
    .trim()
}

/**
 * GitHub's heading slug (github-slugger): lowercase, every character that is
 * not a letter, mark, number, connector, space or hyphen dropped, spaces to
 * hyphens. Accented letters stay: `## Comentários que o gate lê` is
 * `#comentários-que-o-gate-lê`.
 */
function slugify(text) {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** Every anchor a markdown file offers: heading slugs, numbered on repeats, and explicit `<a id>`. */
function anchorsOf(markdown) {
  const { lines, prose } = markdown
  const anchors = new Set()
  const occurrences = new Map()
  const add = (heading) => {
    const base = slugify(renderedText(heading))
    let slug = base
    // github-slugger: the second "Uso" is uso-1, the third uso-2.
    while (occurrences.has(slug)) {
      const next = occurrences.get(base) + 1
      occurrences.set(base, next)
      slug = `${base}-${next}`
    }
    occurrences.set(slug, 0)
    anchors.add(slug)
  }
  lines.forEach((line, index) => {
    const text = prose[index]
    if (text === null || text.trim() === '') return
    for (const explicit of line.matchAll(
      /<a\s[^>]*\b(?:name|id)=["']([^"']+)["']/gi,
    ))
      anchors.add(explicit[1].normalize('NFC'))
    const atx = atxHeading.exec(line)
    if (atx !== null) {
      add(atx[2] ?? '')
      return
    }
    if (index > 0 && isSetextHeading(markdown, index - 1))
      add(lines[index - 1].trim())
  })
  return anchors
}

const inlineLink =
  /!?\[((?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*)\]\([ \t]*(<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*\)/g
/** `[label]: target`; a footnote (`[^1]: text`) is not a link. */
const referenceDefinition =
  /^ {0,3}\[(?!\^)((?:[^[\]\\]|\\.)+)\]:[ \t]*(<[^<>\n]*>|\S+)/

/** The link targets written in one line of prose: inline links and reference definitions. */
function linksIn(text) {
  const found = []
  for (const link of text.matchAll(inlineLink))
    if (link.index === 0 || text[link.index - 1] !== '\\') found.push(link[2])
  const definition = referenceDefinition.exec(text)
  if (definition !== null) found.push(definition[2])
  return found
}

// ---------------------------------------------------------------------------
// The checks

/** `a`, `a e b`, `a, b e c` (or `ou`). */
const joinPt = (items, conjunction = 'e') =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`

/** `1 entrada`, `2 entradas`. */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

const quote = (text) =>
  `"${text.length > 100 ? `${text.slice(0, 99)}…` : text}"`

function checkRepository(cwd) {
  const repository = locate(cwd)
  const { root, git } = repository
  const files = listFiles(repository).sort()
  const fileSet = new Set(files)
  const directories = directoriesOf(files)
  const problems = []
  const report = (file, line, message) =>
    problems.push({ file, line, message, order: problems.length })
  const counts = { files: 0, links: 0, typed: 0, decisions: 0, entries: 0 }

  const isFile = (file) =>
    fileSet.has(file) && existsSync(path.join(root, file))
  const markdownCache = new Map()
  const markdownOf = (file) => {
    if (!markdownCache.has(file))
      markdownCache.set(
        file,
        readMarkdown(readFileSync(path.join(root, file), 'utf8')),
      )
    return markdownCache.get(file)
  }
  const anchorCache = new Map()
  const anchorsFor = (file) => {
    if (!anchorCache.has(file))
      anchorCache.set(file, anchorsOf(markdownOf(file)))
    return anchorCache.get(file)
  }

  /**
   * Where a relative link from `file` lands: `resolved` (relative to the root,
   * '' for the root itself) and the `anchor` after `#`; a same-file anchor
   * (`#…`) lands on `file` itself, with `sameFile`. Null for a link that is
   * not relative (a URL with a scheme, or `//host`); `invalid` for bad
   * percent-encoding, `outside` for a path above the root.
   */
  const resolveLink = (file, target) => {
    let raw = target.trim()
    if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1).trim()
    if (raw.startsWith('#'))
      return { raw, resolved: file, anchor: raw.slice(1), sameFile: true }
    if (raw.startsWith('//')) return null
    if (/^[a-z][a-z\d+.-]*:/i.test(raw)) return null
    const hash = raw.indexOf('#')
    const pathPart = (hash < 0 ? raw : raw.slice(0, hash)).replace(/\?.*$/, '')
    const anchor = hash < 0 ? '' : raw.slice(hash + 1)
    let decoded
    try {
      decoded = decodeURIComponent(pathPart)
    } catch {
      return { raw, invalid: true }
    }
    // GitHub reads a leading `/` as the repository root.
    const joined = decoded.startsWith('/')
      ? decoded.replace(/^\/+/, '')
      : path.posix.join(path.posix.dirname(file), decoded)
    const normalized = path.posix.normalize(joined === '' ? '.' : joined)
    const resolved =
      normalized === '.' ? '' : normalized.replace(/\/+$/, '').normalize('NFC')
    if (resolved === '..' || resolved.startsWith('../'))
      return { raw, outside: true }
    return { raw, resolved, anchor, empty: raw === '' }
  }

  /**
   * A link to a file of main on GitHub (repositoryFileUrl), resolved like a
   * link from the root; null for any other URL or path.
   */
  const resolveRepositoryUrl = (target) => {
    let raw = target.trim()
    if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1).trim()
    if (!raw.startsWith(repositoryFileUrl)) return null
    const link = resolveLink('', `/${raw.slice(repositoryFileUrl.length)}`)
    return link === null ? null : { ...link, raw }
  }

  // (a) Links -----------------------------------------------------------------

  /** A relative link in a file that becomes a PR body: where it should point instead. */
  const pullRequestLinkProblem = (link) => {
    const fix =
      link.resolved === undefined
        ? `um link para ${repositoryFileUrl}<caminho>`
        : `${repositoryFileUrl}${link.resolved}${link.anchor ? `#${link.anchor}` : ''}`
    return `link relativo num template que vira corpo de PR: ${quote(link.raw)}; lá ele resolve a partir da página da PR e dá 404. Use ${fix}, ou nenhum link`
  }

  /**
   * Holds each link of `file` to the repository. With `linksOnly` (the PR
   * template), a relative link is refused outright, a same-file anchor is
   * still held to the file's headings, and a repositoryFileUrl link is
   * checked like a relative one.
   */
  const checkLinks = (file, { linksOnly = false } = {}) => {
    const { prose } = markdownOf(file)
    prose.forEach((text, index) => {
      if (text === null) return
      for (const target of linksIn(text)) {
        const line = index + 1
        let link = resolveLink(file, target)
        if (link === null && linksOnly) link = resolveRepositoryUrl(target)
        else if (link !== null && linksOnly && !link.sameFile) {
          counts.links += 1
          report(file, line, pullRequestLinkProblem(link))
          continue
        }
        if (link === null) continue
        counts.links += 1
        if (link.invalid) {
          report(
            file,
            line,
            `link com codificação inválida: ${quote(link.raw)}`,
          )
          continue
        }
        if (link.outside) {
          report(
            file,
            line,
            `link quebrado: ${quote(link.raw)} sai da raiz do repositório`,
          )
          continue
        }
        if (link.empty) {
          report(file, line, 'link vazio: "()" não aponta para nada')
          continue
        }
        const exists = isFile(link.resolved) || directories.has(link.resolved)
        if (!exists) {
          const hint = git ? ' (ou é ignorado pelo git)' : ''
          report(
            file,
            line,
            `link quebrado: ${quote(link.raw)} aponta para ${link.resolved}, que não existe no repositório${hint}`,
          )
          continue
        }
        if (
          link.anchor === '' ||
          !isFile(link.resolved) ||
          !/\.md$/i.test(link.resolved)
        )
          continue
        let anchor = link.anchor
        try {
          anchor = decodeURIComponent(anchor)
        } catch {
          // Left encoded: the comparison below then fails and reports it.
        }
        anchor = anchor.normalize('NFC')
        if (!anchorsFor(link.resolved).has(anchor))
          report(
            file,
            line,
            `âncora quebrada: ${quote(link.raw)}; nenhum título de ${link.resolved} gera #${anchor}`,
          )
      }
    })
  }

  // (b) Title and Status block ------------------------------------------------

  /** The status token each typed context file declares, when it declares one. */
  const declaredStatus = new Map()

  /** The layout, as the guide's Layout table writes it, for the refusal. */
  const layoutShapes = () =>
    `com tipo, ${joinPt(contextKinds.map(({ shape }) => shape))}; sem tipo, ${joinPt(
      untypedContextPaths.map(({ shape }) =>
        shape === 'README.md' ? 'README.md (índice, em qualquer pasta)' : shape,
      ),
    )}`

  const reportOutsideLayout = (file) =>
    report(
      file,
      1,
      `arquivo fora do layout do Context Mesh: em context/ ficam, ${layoutShapes()}. Uma pasta ou forma nova entra antes em scripts/loop-sections.mjs e na seção Layout de context/README.md`,
    )

  const checkTyped = (file) => {
    const relative = file.slice('context/'.length)
    if (isUntypedContextFile(relative)) return
    const markdown = markdownOf(file)
    const { lines, prose } = markdown
    const expected = contextKindOf(relative)
    if (expected === null) {
      reportOutsideLayout(file)
      return
    }
    counts.typed += 1
    const first = lines[0] ?? ''
    const title = /^# ([^:]+): *(\S.*)$/.exec(first)
    if (title === null)
      report(
        file,
        1,
        `a primeira linha deve ser "# ${expected.title}: <título>", com dois-pontos; está ${quote(first)}`,
      )
    else if (title[1] !== expected.title)
      report(
        file,
        1,
        `o título declara "${title[1]}", mas o caminho do arquivo pede "${expected.title}"`,
      )

    const blocks = []
    prose.forEach((text, index) => {
      if (text !== null && statusHeading.test(text)) blocks.push(index)
    })
    if (blocks.length === 0) {
      // Named at the last line: the block closes the file.
      report(
        file,
        Math.max(1, lines.findLastIndex((line) => line.trim() !== '') + 1),
        'sem bloco "## Status"; todo intent, decisão, pattern, anti-pattern e agente termina com um',
      )
      return
    }
    if (blocks.length > 1) {
      for (const extra of blocks.slice(1))
        report(
          file,
          extra + 1,
          `bloco "## Status" repetido (o primeiro está na linha ${blocks[0] + 1}); deve haver exatamente um`,
        )
      return
    }
    const [start] = blocks
    // The block closes the file: a section after it, an ATX `#`/`##` heading
    // (an empty one too) or a setext one (a line underlined with `===` or
    // `---`), is refused, and the block is read up to that section.
    const nextSection = prose.findIndex(
      (text, index) =>
        index > start &&
        text !== null &&
        (/^ {0,3}#{1,2}(?:[ \t]|$)/.test(text) ||
          isSetextHeading(markdown, index)),
    )
    if (nextSection >= 0)
      report(
        file,
        nextSection + 1,
        `a seção ${quote(prose[nextSection].trim() || lines[nextSection].trim())} vem depois do bloco Status (linha ${start + 1}); o bloco Status é a última seção do arquivo`,
      )
    const end = nextSection < 0 ? lines.length : nextSection
    // Read from the prose: a status in code or in an HTML comment is an
    // example, not a declaration.
    const declared = []
    let malformed = false
    prose.forEach((text, index) => {
      if (text === null || !statusDeclaration.test(text)) return
      if (index <= start || index >= end) {
        report(
          file,
          index + 1,
          `status declarado fora do bloco Status (linha ${start + 1}); o status só se declara lá, uma vez`,
        )
        return
      }
      const status = statusLine.exec(text)
      if (status === null) {
        malformed = true
        report(
          file,
          index + 1,
          `linha de status fora do formato "- **Status**: <valor>": ${quote(lines[index].trim())}`,
        )
        return
      }
      declared.push({ index, token: status[1] })
    })
    if (declared.length === 0) {
      if (!malformed)
        report(
          file,
          start + 1,
          'o bloco Status não tem a linha "- **Status**: <valor>"',
        )
      return
    }
    if (declared.length > 1) {
      for (const extra of declared.slice(1))
        report(
          file,
          extra.index + 1,
          `linha "- **Status**:" repetida no bloco Status (a primeira está na linha ${declared[0].index + 1})`,
        )
      return
    }
    const [{ index, token }] = declared
    if (!expected.statuses.includes(token)) {
      report(
        file,
        index + 1,
        `status ${quote(token)} não vale para ${expected.kind}; use ${joinPt(
          expected.statuses.map((status) => `"${status}"`),
          'ou',
        )}`,
      )
      return
    }
    declaredStatus.set(file, token)
  }

  // (c) The decision index ----------------------------------------------------

  const checkDecisionIndex = (decisions) => {
    if (decisions.length === 0) return
    if (!isFile(decisionIndex)) {
      report(
        decisionIndex,
        1,
        `o índice de decisões não existe, e há ${count(decisions.length, 'decisão', 'decisões')} em context/decisions/`,
      )
      return
    }
    const { lines, prose } = markdownOf(decisionIndex)
    const rows = new Map()
    let tableLine = 0
    let statusColumn = -1
    let header = true
    const cellsOf = (index) => {
      // Split where the prose has pipes: a pipe inside a code span is blanked
      // there, so it does not split a cell.
      const text = prose[index]
      const cuts = []
      for (let at = 0; at < text.length; at += 1)
        if (text[at] === '|' && text[at - 1] !== '\\') cuts.push(at)
      const cells = []
      for (let cut = 0; cut + 1 < cuts.length; cut += 1)
        cells.push({
          raw: lines[index].slice(cuts[cut] + 1, cuts[cut + 1]).trim(),
          prose: text.slice(cuts[cut] + 1, cuts[cut + 1]),
        })
      return cells
    }
    prose.forEach((text, index) => {
      if (text === null || !/^ {0,3}\|/.test(text)) {
        header = true
        statusColumn = -1
        return
      }
      const cells = cellsOf(index)
      if (cells.every((cell) => /^:?-+:?$/.test(cell.raw))) return
      if (header) {
        header = false
        statusColumn = cells.findIndex(
          (cell) => cell.raw.replace(/[`*_]/g, '').toLowerCase() === 'status',
        )
        if (statusColumn >= 0 && tableLine === 0) tableLine = index + 1
        return
      }
      if (statusColumn < 0) return
      const linked = new Set()
      for (const cell of cells)
        for (const target of linksIn(cell.prose)) {
          const link = resolveLink(decisionIndex, target)
          if (link === null || link.resolved === undefined) continue
          const relative = link.resolved.replace(/^context\//, '')
          if (
            link.resolved.startsWith('context/') &&
            contextKindOf(relative)?.kind === 'ADR'
          )
            linked.add(link.resolved)
        }
      const status = (cells[statusColumn]?.raw ?? '')
        .replace(/^[`*_]+|[`*_]+$/g, '')
        .trim()
      for (const file of linked) {
        if (!rows.has(file)) rows.set(file, [])
        rows.get(file).push({ line: index + 1, status })
      }
    })
    if (tableLine === 0) {
      report(
        decisionIndex,
        1,
        'o índice não tem uma tabela com a coluna Status, e toda decisão precisa de uma linha nela',
      )
      return
    }
    for (const file of decisions) {
      counts.decisions += 1
      const name = path.posix.basename(file)
      const listed = rows.get(file) ?? []
      if (listed.length === 0) {
        report(
          decisionIndex,
          tableLine,
          `a decisão ${name} não tem linha na tabela do índice`,
        )
        continue
      }
      if (listed.length > 1) {
        for (const extra of listed.slice(1))
          report(
            decisionIndex,
            extra.line,
            `a decisão ${name} aparece em mais de uma linha do índice (a primeira é a linha ${listed[0].line}); deve ser uma só`,
          )
        continue
      }
      const declared = declaredStatus.get(file)
      if (declared !== undefined && listed[0].status !== declared)
        report(
          decisionIndex,
          listed[0].line,
          `o índice diz ${quote(listed[0].status)} para ${name}, mas o arquivo diz "${declared}"`,
        )
    }
  }

  // (d) Changelog headings ----------------------------------------------------

  const checkChangelog = () => {
    if (!isFile(changelogFile)) return
    const { lines, prose } = markdownOf(changelogFile)
    lines.forEach((line, index) => {
      if (prose[index] === null || !line.startsWith('## ')) return
      counts.entries += 1
      if (!changelogHeading.test(line))
        report(
          changelogFile,
          index + 1,
          `título de entrada fora do formato "## AAAA-MM-DD: <o que mudou> (#N)" ou "(#N, PR #P)": ${quote(line)}`,
        )
    })
  }

  // (e) Machine paths ---------------------------------------------------------

  // A prefix followed by a real path segment: the bare `/Users/` quoted in
  // prose names the rule, it does not leak a machine. Code blocks count too.
  // The temp directories are where test output and scratch files point:
  // macOS's os.tmpdir() under /private/var/folders/ (or /var/folders/), and
  // /tmp/<segment>/ as much as /private/tmp/.
  const machinePath =
    /(?<![\w.~-])(?:\/(?:Users|Volumes)\/[^\s/`'"()<>[\]]+|\/home\/[^\s/`'"()<>[\]]+\/|\/private\/(?:tmp|var)\/[^\s`'"()<>[\]]|\/var\/folders\/[^\s`'"()<>[\]]|\/tmp\/[^\s/`'"()<>[\]]+\/)[^\s`'"()<>[\]]*|(?<!\w)[A-Za-z]:\\[^\s\\`'"()<>[\]][^\s`'"()<>[\]]*/g

  const checkMachinePaths = (file) => {
    markdownOf(file).lines.forEach((line, index) => {
      for (const found of line.matchAll(machinePath))
        report(
          file,
          index + 1,
          // The sentence's own full stop or comma is not part of the path.
          `caminho absoluto de máquina ${quote(found[0].replace(/[.,;:]+$/, ''))}; escreva o caminho relativo à raiz do repositório`,
        )
    })
  }

  // ---------------------------------------------------------------------------

  const scanned = files.filter(
    (file) =>
      file === 'AGENTS.md' ||
      file === 'CLAUDE.md' ||
      ((file.startsWith('context/') || file.startsWith('docs/')) &&
        file.endsWith('.md')),
  )
  const linksOnly = linksOnlyFiles.filter((file) => fileSet.has(file))
  for (const file of scanned) {
    if (!isFile(file)) continue
    counts.files += 1
    checkLinks(file)
  }
  for (const file of linksOnly) {
    if (!isFile(file)) continue
    counts.files += 1
    checkLinks(file, { linksOnly: true })
  }
  for (const file of scanned) {
    if (!isFile(file)) continue
    if (file.startsWith('context/')) checkTyped(file)
    checkMachinePaths(file)
  }
  // Context Mesh is markdown: any other file under context/ is outside the
  // layout too, so the Layout table stays the whole list of what lives there.
  // A hidden one (a dotfile, or anything in a dot-directory) is left out: an
  // editor's or the OS's own (.DS_Store after a Finder visit, .obsidian/ when
  // the folder is opened as a vault) is no content, and must not turn
  // `npm run check` red on the machine that made it.
  for (const file of files)
    if (
      file.startsWith('context/') &&
      !file.endsWith('.md') &&
      !isHidden(file) &&
      isFile(file)
    )
      reportOutsideLayout(file)
  checkDecisionIndex(
    scanned.filter(
      (file) =>
        isFile(file) &&
        file.startsWith('context/') &&
        contextKindOf(file.slice('context/'.length))?.kind === 'ADR',
    ),
  )
  checkChangelog()

  // Code-point order, not the locale's: the same list on every machine.
  const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  problems.sort(
    (a, b) => byName(a.file, b.file) || a.line - b.line || a.order - b.order,
  )
  return { problems, counts }
}

function main() {
  const { problems, counts } = checkRepository(process.cwd())
  if (problems.length === 0) {
    const checked = [
      count(counts.links, 'link interno', 'links internos'),
      count(counts.typed, 'bloco Status', 'blocos Status'),
      count(counts.decisions, 'decisão no índice', 'decisões no índice'),
      count(counts.entries, 'entrada do changelog', 'entradas do changelog'),
    ]
    console.log(
      `check:context: nenhum problema em ${count(counts.files, 'arquivo', 'arquivos')}: ${joinPt(checked)}.`,
    )
    return 0
  }
  const lines = [
    `check:context: ${count(problems.length, 'problema', 'problemas')}.`,
    ...problems.map(
      ({ file, line, message }) => `- ${file}:${line}: ${message}`,
    ),
    'Os formatos estão no guia do Context Mesh (context/README.md).',
  ]
  console.error(lines.join('\n'))
  return 1
}

process.exitCode = main()
