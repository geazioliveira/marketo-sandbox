// A shell command line, read the way bash would run it, far enough for the
// loop's rules: which programs run, with which arguments, in which
// directory, with what on stdin.
//
// The hooks judge `gh` and `git` by their argv, so the parser has to see the
// argv bash builds, not the words a regex finds. `gh issue edit 5
// --add-label "ready-for-agent"` and `gh issue edit 5 --add-label
// ready-for-agent` are one command; `echo "gh issue edit"` is no gh at all;
// and a `gh` hidden in `$(...)`, behind `sudo`, `env` or `nohup`, or inside
// `bash -c '...'` still runs. Every form of it is read, and what cannot be
// read is said so (`unparsable`, a word's `known` false), for the rules to
// ask about instead of passing.
//
// It is not a shell. Besides `~`, the only expansions it performs are `$NAME`
// and `${NAME}` of a variable the same line assigned before, for sure and to
// a value known in full (`SP=/x; gh issue comment 8 -F "$SP/plano.md"`):
// see "Variables the line assigns"; and `"$(cat <<'EOF' … EOF)"`, read as
// its heredoc (catHeredocText). Every other `$...` and every substitution
// stays as text, and the word that holds one is marked unknown.
// A substitution is kept as `$(...)` text whatever its spelling (a backtick
// one too), so any rule that only checks for `$` still sees it.
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * How deep substitutions, `bash -c` and `eval` may nest. Past it the line
 * is unparsable: a real command never nests this far, and a crafted one must
 * not overflow the stack of the hook that reads it.
 */
const maxDepth = 24

class DepthLimit extends Error {}

/** Characters that end an unquoted word. */
const wordEnd = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>'])

/** Redirection operators, longest first so `<<<` is not read as `<<`. */
const redirections = [
  '<<<',
  '<<-',
  '&>>',
  '<<',
  '<>',
  '<&',
  '>>',
  '>|',
  '>&',
  '&>',
  '<',
  '>',
]

/** Operators that end a case branch; a pattern comes after them. */
const branchEnds = new Set([';;', ';&', ';;&'])

/** Operators after which the list needs another command. */
const binaryOperators = new Set(['&&', '||', '|', '|&'])

/** Reserved words that open or close a compound command; the command after them runs. */
const reservedWords = new Set([
  '!',
  '{',
  '}',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'while',
  'until',
  'do',
  'done',
  'esac',
  'coproc',
])

/** Words that open a header which runs nothing itself (`for x in a b`). */
const headerWords = new Set(['for', 'select', 'case'])

const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/

const shells = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

/**
 * Programs that run the command after their own options, and how to skip
 * those options: letters that take a value (`valued`), long options that
 * take one (`long`), operands before the command (`operands`), and whether
 * `-<digits>` is an option (`numeric`). For env, the options that take
 * variables out of the command's environment: `unsets` one (`-u NAME`),
 * `clears` all of them (`-i`, and a lone `-`, which env reads as `-i`).
 */
const wrappers = new Map([
  ['command', { stopIf: ['-v', '-V'] }],
  ['exec', { valued: 'a' }],
  ['nohup', {}],
  ['time', { valued: 'of' }],
  ['builtin', {}],
  ['noglob', {}],
  ['nocorrect', {}],
  [
    'sudo',
    {
      valued: 'aCcDghpRrTtUu',
      long: [
        '--user',
        '--group',
        '--chdir',
        '--host',
        '--prompt',
        '--role',
        '--type',
        '--command-timeout',
        '--other-user',
        '--close-from',
        '--chroot',
        '--login-class',
      ],
      chdir: ['-D', '--chdir'],
      assignments: true,
    },
  ],
  ['doas', { valued: 'uC' }],
  [
    'env',
    {
      valued: 'uCPS',
      long: ['--unset', '--chdir', '--split-string'],
      chdir: ['-C', '--chdir'],
      split: ['-S', '--split-string'],
      unsets: ['-u', '--unset'],
      clears: ['-i', '--ignore-environment', '-'],
      assignments: true,
    },
  ],
  ['nice', { valued: 'n', long: ['--adjustment'], numeric: true }],
  [
    'timeout',
    { valued: 'sk', long: ['--signal', '--kill-after'], operands: 1 },
  ],
  [
    'gtimeout',
    { valued: 'sk', long: ['--signal', '--kill-after'], operands: 1 },
  ],
  [
    'xargs',
    {
      valued: 'aEdIJLnPRSs',
      long: [
        '--arg-file',
        '--delimiter',
        '--max-args',
        '--max-lines',
        '--max-procs',
        '--max-chars',
        '--replace',
        '--eof',
      ],
      stdinConsumed: true,
    },
  ],
  ['caffeinate', { valued: 'tw' }],
  ['stdbuf', { valued: 'ioe' }],
  ['setsid', {}],
])

// ---------------------------------------------------------------------------
// Lexing

/**
 * The text of `$(cat <<'EOF' … EOF)`, the way a commit message or a PR body
 * is written in a Claude Code session: a substitution that is only `cat`
 * (or `cat -`) reading one heredoc whose body holds no expansion. The shell
 * drops the trailing newlines of a substitution, and so does this. null for
 * any other substitution, which stays unknown (Copilot review of #26: an
 * unknown message or body now asks, so the common form must stay readable).
 */
function catHeredocText(tokens) {
  const parts = tokens.filter(
    (token) => !(token.type === 'op' && token.op === '\n'),
  )
  if (parts.some((token) => token.type === 'op')) return null
  const words = parts.filter((token) => token.type === 'word')
  const redirs = parts.filter((token) => token.type === 'redir')
  if (words.length === 0 || words.length > 2 || redirs.length !== 1) return null
  if (!words.every((word) => word.known && word.subs.length === 0)) return null
  if (words[0].value !== 'cat') return null
  if (words[1] !== undefined && words[1].value !== '-') return null
  const { heredoc, fd } = redirs[0]
  if (heredoc == null || (fd !== null && fd !== '0')) return null
  if (!heredoc.known || typeof heredoc.body !== 'string') return null
  return heredoc.body.replace(/\n+$/, '')
}

/** The value of a `$'...'` escape (bash's ANSI-C quoting). */
function ansiEscape(src, at) {
  const letter = src[at]
  const simple = {
    n: '\n',
    t: '\t',
    r: '\r',
    a: '\x07',
    b: '\b',
    e: '\x1b',
    E: '\x1b',
    f: '\f',
    v: '\v',
    '\\': '\\',
    "'": "'",
    '"': '"',
    '?': '?',
  }
  if (letter in simple) return { text: simple[letter], next: at + 1 }
  const digits = (pattern, max, from) => {
    let end = from
    while (end < src.length && end - from < max && pattern.test(src[end]))
      end += 1
    return end
  }
  if (letter === 'x' || letter === 'u' || letter === 'U') {
    const end = digits(/[0-9A-Fa-f]/, { x: 2, u: 4, U: 8 }[letter], at + 1)
    if (end === at + 1) return { text: `\\${letter}`, next: at + 1 }
    const code = Number.parseInt(src.slice(at + 1, end), 16)
    return {
      text: code <= 0x10ffff ? String.fromCodePoint(code) : '',
      next: end,
    }
  }
  if (/[0-7]/.test(letter ?? '')) {
    const end = digits(/[0-7]/, 3, at)
    return {
      text: String.fromCharCode(Number.parseInt(src.slice(at, end), 8) & 0xff),
      next: end,
    }
  }
  if (letter === 'c' && at + 1 < src.length)
    return {
      text: String.fromCharCode(src.charCodeAt(at + 1) & 0x1f),
      next: at + 2,
    }
  if (letter === undefined) return { text: '\\', next: at }
  return { text: `\\${letter}`, next: at + 1 }
}

/**
 * A lexer over one source text. Tokens:
 * - word: { type, value, raw, known, quoted, subs, refs, opaque, assigns,
 *   start, end }. `known` is false when the word holds an expansion or a
 *   substitution; `quoted` when any of it was quoted or escaped; `subs` are
 *   the command lists of its substitutions, as { src, tokens }. `refs` are
 *   its plain `$NAME` and `${NAME}`, as { name, start, end, split } over
 *   `value` (`split` when unquoted); `opaque` when it holds any other
 *   expansion or a substitution, which no variable of the line can fill in;
 *   `assigns` when one of its expansions may assign a variable (`$((n=1))`,
 *   `${n:=1}`).
 * - op: { type, op, start, end }, for `&&`, `||`, `;`, `;;`, `|`, `|&`, `&`,
 *   newline, `(` and `)`.
 * - redir: { type, op, fd, target, heredoc, start, end }.
 */
function lexer(src, state, baseDepth) {
  const n = src.length
  let i = 0
  let depth = baseDepth

  const nested = (read) => {
    depth += 1
    if (depth > maxDepth) throw new DepthLimit()
    try {
      return read()
    } finally {
      depth -= 1
    }
  }

  /** Another source (a backtick body, a heredoc) lexed on its own, one level down. */
  const child = (text) => {
    if (depth + 1 > maxDepth) throw new DepthLimit()
    return lexer(text, state, depth + 1)
  }

  const skipBlanks = () => {
    for (;;) {
      if (src[i] === ' ' || src[i] === '\t') i += 1
      else if (src[i] === '\\' && src[i + 1] === '\n') i += 2
      else return
    }
  }

  /** `$(` ... `)`, from just after `$(`: the tokens inside, as one list. */
  function substitution(subs) {
    state.substitution = true
    const inner = nested(() => tokens(true))
    subs.push({ src, tokens: inner })
  }

  /**
   * `$((...))` is arithmetic; `$( (list) )` is a substitution that starts with
   * a subshell. bash tells them apart by whether the second parenthesis
   * closes right before the first: so does this.
   */
  function arithmeticOrSubstitution(subs) {
    const open = i
    let level = 0
    let k = i + 1
    let innerClose = -1
    for (; k < n; k += 1) {
      const c = src[k]
      if (c === '\\') {
        k += 1
        continue
      }
      if (c === '(') level += 1
      else if (c === ')') {
        level -= 1
        if (level === 1 && innerClose < 0) innerClose = k
        if (level === 0) break
      }
    }
    if (
      innerClose >= 0 &&
      src[innerClose + 1] === ')' &&
      k === innerClose + 1
    ) {
      // Arithmetic: a substitution inside it still runs.
      i = open + 3
      while (i < innerClose) {
        if (src[i] === '$' && src[i + 1] === '(' && src[i + 2] !== '(') {
          i += 2
          substitution(subs)
        } else if (src[i] === '`') readBacktick(subs, false)
        else i += 1
      }
      i = k + 1
      const value = src.slice(open, i)
      return { value, known: false, assigns: arithmeticAssigns(value) }
    }
    // A substitution, or unterminated either way: read as one, it fails the
    // same, but keeps whatever commands it holds.
    i = open + 2
    substitution(subs)
    return { value: src.slice(open, i), known: false }
  }

  /** `${...}`, from just after `${`, to its matching brace. */
  function skipBraces(subs) {
    let level = 1
    while (i < n) {
      const c = src[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === "'") {
        const close = src.indexOf("'", i + 1)
        i = close < 0 ? n : close + 1
        continue
      }
      if (c === '"') {
        i += 1
        readDouble(subs, false)
        continue
      }
      if (c === '$' || c === '`') {
        if (c === '`') readBacktick(subs, true)
        else readDollar(subs, true)
        continue
      }
      if (c === '{') level += 1
      else if (c === '}') {
        level -= 1
        if (level === 0) {
          i += 1
          return
        }
      }
      i += 1
    }
    state.unparsable = true
  }

  /** At a `$`: an expansion, a substitution, a quoting form, or a plain `$`. */
  function readDollar(subs, inDouble) {
    const open = i
    const next = src[i + 1]
    if (!inDouble && next === "'") {
      i += 2
      let value = ''
      while (i < n && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < n) {
          const escape = ansiEscape(src, i + 1)
          value += escape.text
          i = escape.next
        } else {
          value += src[i]
          i += 1
        }
      }
      if (i >= n) state.unparsable = true
      else i += 1
      return { value, known: true, quoted: true }
    }
    if (!inDouble && next === '"') {
      i += 2
      return { ...readDouble(subs, false), quoted: true }
    }
    if (next === '(') {
      if (src[i + 2] === '(') return arithmeticOrSubstitution(subs)
      i += 2
      substitution(subs)
      // Inside double quotes the output is one word, as the heredoc wrote
      // it: `"$(cat <<'EOF' … EOF)"` is read as its text. Unquoted, the shell
      // would split it, so it stays unknown. `cat` marks a value that holds
      // only while cat is the program (see simple()).
      const text = inDouble ? catHeredocText(subs.at(-1).tokens) : null
      if (text !== null) return { value: text, known: true, cat: true }
      return { value: src.slice(open, i), known: false }
    }
    if (next === '{') {
      i += 2
      // `${` can nest, through quotes too (`"${a:-"${b}"}"`): a level of
      // depth like a substitution, so a crafted line cannot overflow the stack.
      nested(() => skipBraces(subs))
      const value = src.slice(open, i)
      // Only the plain `${NAME}` is a variable's value; `${NAME:=x}` and
      // the other operators are not, and one with `=` may assign.
      const name = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)?.[1]
      if (name !== undefined) return { value, known: false, ref: name }
      return { value, known: false, assigns: value.includes('=') }
    }
    if (next === '[') {
      const close = src.indexOf(']', i + 2)
      if (close < 0) state.unparsable = true
      i = close < 0 ? n : close + 1
      const value = src.slice(open, i)
      return { value, known: false, assigns: arithmeticAssigns(value) }
    }
    if (next !== undefined && /[A-Za-z_]/.test(next)) {
      i += 1
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i += 1
      const value = src.slice(open, i)
      // zsh, the shell these lines run in, reads `$NAME[...]` as a subscript
      // (whose arithmetic may assign) and `$NAME:h` as a modifier: neither
      // is the variable's plain value.
      if (src[i] === '[') return { value, known: false, assigns: true }
      if (src[i] === ':') return { value, known: false }
      return { value, known: false, ref: value.slice(1) }
    }
    if (next !== undefined && /[0-9@*#?$!-]/.test(next)) {
      i += 2
      return { value: src.slice(open, i), known: false }
    }
    if (
      next !== undefined &&
      /[=~^+]/.test(next) &&
      /[A-Za-z_{]/.test(src[i + 2] ?? '')
    ) {
      // zsh's `$=NAME`, `$~NAME`, `$^NAME` and `$+NAME` expand NAME: an
      // expansion, not a plain `$`.
      i += 2
      return { value: src.slice(open, i), known: false }
    }
    i += 1
    return { value: '$', known: true }
  }

  /**
   * From an opening backtick: its body is unescaped (`\$`, `` \` ``, `\\`, and
   * `\"` inside double quotes) and lexed as a command list of its own.
   */
  function readBacktick(subs, inDouble) {
    i += 1
    let body = ''
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\' && i + 1 < n) {
        const next = src[i + 1]
        if (
          next === '$' ||
          next === '`' ||
          next === '\\' ||
          (inDouble && next === '"')
        ) {
          body += next
          i += 2
          continue
        }
      }
      body += src[i]
      i += 1
    }
    if (i >= n) state.unparsable = true
    else i += 1
    state.substitution = true
    subs.push({ src: body, tokens: child(body).all() })
    return { value: `$(${body})`, known: false }
  }

  /**
   * Double-quoted text, from just after the opening quote. In `heredoc` mode
   * it reads an unquoted heredoc body instead: to the end, with `"` plain.
   */
  function readDouble(subs, heredoc) {
    let value = ''
    let known = true
    let opaque = false
    let assigns = false
    let cat = false
    const refs = []
    const result = () => ({ value, known, refs, opaque, assigns, cat })
    while (i < n) {
      const c = src[i]
      if (!heredoc && c === '"') {
        i += 1
        return result()
      }
      if (c === '\\') {
        const next = src[i + 1]
        if (next === '\n') {
          i += 2
          continue
        }
        if (
          next === '$' ||
          next === '`' ||
          next === '\\' ||
          (!heredoc && next === '"')
        ) {
          value += next
          i += 2
          continue
        }
        value += '\\'
        i += 1
        continue
      }
      if (c === '$') {
        const part = readDollar(subs, true)
        // Inside double quotes (and a heredoc) an expansion is not split.
        if (part.ref !== undefined)
          refs.push({
            name: part.ref,
            start: value.length,
            end: value.length + part.value.length,
            split: false,
          })
        else if (!part.known) opaque = true
        if (part.assigns) assigns = true
        if (part.cat) cat = true
        value += part.value
        if (!part.known) known = false
        continue
      }
      if (c === '`') {
        value += readBacktick(subs, true).value
        known = false
        opaque = true
        continue
      }
      value += c
      i += 1
    }
    if (!heredoc) state.unparsable = true
    return result()
  }

  function readWord() {
    const start = i
    const subs = []
    const refs = []
    let value = ''
    let known = true
    let quoted = false
    let opaque = false
    let assigns = false
    let cat = false
    /** A part read by readDollar or readDouble, appended to the word. */
    const absorb = (part, split) => {
      if (part.cat) cat = true
      if (part.ref !== undefined)
        refs.push({
          name: part.ref,
          start: value.length,
          end: value.length + part.value.length,
          split,
        })
      for (const ref of part.refs ?? [])
        refs.push({
          ...ref,
          start: ref.start + value.length,
          end: ref.end + value.length,
        })
      if (part.opaque) opaque = true
      else if (!part.known && part.ref === undefined && part.refs === undefined)
        opaque = true
      if (part.assigns) assigns = true
      if (!part.known) known = false
      value += part.value
    }
    while (i < n) {
      const c = src[i]
      if (c === '\\') {
        if (src[i + 1] === '\n') {
          i += 2
          continue
        }
        if (i + 1 >= n) {
          value += '\\'
          i += 1
          continue
        }
        value += src[i + 1]
        quoted = true
        i += 2
        continue
      }
      if (c === "'") {
        quoted = true
        const close = src.indexOf("'", i + 1)
        if (close < 0) {
          state.unparsable = true
          value += src.slice(i + 1)
          i = n
          break
        }
        value += src.slice(i + 1, close)
        i = close + 1
        continue
      }
      if (c === '"') {
        quoted = true
        i += 1
        absorb(readDouble(subs, false), false)
        continue
      }
      if (c === '$') {
        const part = readDollar(subs, false)
        // Unquoted, the value of an expansion is split and globbed.
        absorb(part, true)
        if (part.quoted) quoted = true
        continue
      }
      if (c === '`') {
        value += readBacktick(subs, false).value
        known = false
        opaque = true
        continue
      }
      if ((c === '<' || c === '>') && src[i + 1] === '(') {
        // A process substitution: a command whose output is a file name.
        const open = i
        i += 2
        substitution(subs)
        value += src.slice(open, i)
        known = false
        opaque = true
        continue
      }
      if (c === '(' && !quoted && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(value)) {
        // An array assignment, `A=(a b)`: one word, not a subshell.
        const open = i
        let level = 0
        while (i < n) {
          const d = src[i]
          if (d === '\\') i += 2
          else if (d === "'") {
            const close = src.indexOf("'", i + 1)
            i = close < 0 ? n : close + 1
          } else if (d === '"') {
            i += 1
            readDouble(subs, false)
          } else if (d === '$') readDollar(subs, false)
          else if (d === '`') readBacktick(subs, false)
          else {
            if (d === '(') level += 1
            if (d === ')') level -= 1
            i += 1
            if (level === 0) break
          }
        }
        if (level !== 0) state.unparsable = true
        value += src.slice(open, i)
        known = false
        opaque = true
        continue
      }
      if (wordEnd.has(c)) break
      if (c === '~' && i === start) {
        const next = src[i + 1]
        if (next === undefined || next === '/' || wordEnd.has(next)) {
          value += os.homedir()
          i += 1
          continue
        }
      }
      value += c
      i += 1
    }
    return {
      type: 'word',
      value,
      raw: src.slice(start, i),
      known,
      quoted,
      subs,
      refs,
      opaque,
      assigns,
      cat,
      start,
      end: i,
    }
  }

  /** Whether the next thing is no word: the end, an operator, a newline. */
  const atWordEnd = () =>
    i >= n ||
    '\n;&|()'.includes(src[i]) ||
    ((src[i] === '<' || src[i] === '>') && src[i + 1] !== '(')

  function readRedirect(fd, start, pending) {
    const op = redirections.find((candidate) => src.startsWith(candidate, i))
    i += op.length
    skipBlanks()
    if (atWordEnd()) {
      // `echo >` is a syntax error: bash runs nothing, and neither is read.
      state.unparsable = true
      return {
        type: 'redir',
        op,
        fd,
        target: null,
        heredoc: null,
        start,
        end: i,
      }
    }
    const target = readWord()
    if (op === '<<' || op === '<<-') {
      // The delimiter's quotes are removed and nothing in it is expanded; any
      // quoting makes the body literal.
      const quoted = /['"\\]/.test(target.raw)
      const heredoc = {
        delimiter: quoted ? target.value : target.raw,
        strip: op === '<<-',
        quoted,
        body: null,
        known: false,
        subs: [],
        refs: [],
        opaque: false,
        assigns: false,
      }
      pending.push(heredoc)
      return { type: 'redir', op, fd, target: null, heredoc, start, end: i }
    }
    return { type: 'redir', op, fd, target, heredoc: null, start, end: i }
  }

  /** The bodies of the heredocs opened on the line just ended, in order. */
  function readBodies(pending) {
    for (const heredoc of pending) {
      let body = ''
      let closed = false
      while (i < n) {
        const newline = src.indexOf('\n', i)
        const line = newline < 0 ? src.slice(i) : src.slice(i, newline)
        i = newline < 0 ? n : newline + 1
        const text = heredoc.strip ? line.replace(/^\t+/, '') : line
        if (text === heredoc.delimiter) {
          closed = true
          break
        }
        body += `${text}\n`
      }
      // bash runs a heredoc cut short by the end of the text, with a
      // warning; it is still read, and said to be unparsable.
      if (!closed) state.unparsable = true
      if (heredoc.quoted) {
        heredoc.body = body
        heredoc.known = true
      } else {
        const expanded = child(body).expand(heredoc.subs)
        heredoc.body = expanded.value
        heredoc.known = expanded.known
        heredoc.refs = expanded.refs
        heredoc.opaque = expanded.opaque
        heredoc.assigns = expanded.assigns
        heredoc.cat = expanded.cat
      }
    }
  }

  /**
   * The tokens from here: to the end, or, `untilParen`, to the `)` that closes
   * the substitution this was called for (consumed).
   */
  function tokens(untilParen) {
    const list = []
    const pending = []
    let parens = 0
    let closed = !untilParen
    while (i < n) {
      const c = src[i]
      if (c === ' ' || c === '\t') {
        i += 1
        continue
      }
      if (c === '\\' && src[i + 1] === '\n') {
        i += 2
        continue
      }
      if (c === '#') {
        // A comment runs to the end of the line; bash and zsh -c both read it.
        while (i < n && src[i] !== '\n') i += 1
        continue
      }
      if (c === '\n') {
        list.push({ type: 'op', op: '\n', start: i, end: i + 1 })
        i += 1
        if (pending.length > 0) readBodies(pending.splice(0))
        continue
      }
      if (c === ';') {
        const op = src.startsWith(';;&', i)
          ? ';;&'
          : src.startsWith(';;', i)
            ? ';;'
            : src.startsWith(';&', i)
              ? ';&'
              : ';'
        list.push({ type: 'op', op, start: i, end: i + op.length })
        i += op.length
        continue
      }
      if (c === '&' && src[i + 1] === '>') {
        list.push(readRedirect(null, i, pending))
        continue
      }
      if (c === '&' || c === '|') {
        const op =
          src[i + 1] === c ? c + c : c === '|' && src[i + 1] === '&' ? '|&' : c
        list.push({ type: 'op', op, start: i, end: i + op.length })
        i += op.length
        continue
      }
      if (c === '(') {
        parens += 1
        list.push({ type: 'op', op: '(', start: i, end: i + 1 })
        i += 1
        continue
      }
      if (c === ')') {
        if (untilParen && parens === 0) {
          i += 1
          closed = true
          break
        }
        parens -= 1
        list.push({ type: 'op', op: ')', start: i, end: i + 1 })
        i += 1
        continue
      }
      if ((c === '<' || c === '>') && src[i + 1] !== '(') {
        list.push(readRedirect(null, i, pending))
        continue
      }
      const start = i
      const word = readWord()
      if (i === start) {
        // Nothing read: step over the character rather than loop on it.
        i += 1
        continue
      }
      if (
        (src[i] === '<' || src[i] === '>') &&
        src[i + 1] !== '(' &&
        /^\d+$/.test(word.raw)
      ) {
        // `2>`, `0<`: the digits are the descriptor, not a word.
        list.push(readRedirect(word.value, start, pending))
        continue
      }
      list.push(word)
    }
    if (!closed) state.unparsable = true
    if (pending.length > 0) {
      // Heredocs opened on the last line, with no body after it.
      state.unparsable = true
      for (const heredoc of pending) {
        heredoc.body = ''
        heredoc.known = false
        heredoc.opaque = true
      }
    }
    return list
  }

  return {
    all: () => tokens(false),
    /** The whole text as an unquoted heredoc body: expansions read, `"` plain. */
    expand: (subs) => readDouble(subs, true),
  }
}

// ---------------------------------------------------------------------------
// Building simple commands

const isBare = (word, text) =>
  word !== undefined && word.known && !word.quoted && word.value === text

/** A word as a simple command carries it: the value, whether known, the raw text. */
const item = (word) => ({
  value: word.value,
  known: word.known,
  quoted: word.quoted,
  raw: word.raw,
})

/** A string a wrapper splits into words (`env -S '...'`), as items. */
function splitWords(text, state, depth) {
  const inner = lexer(text, state, depth + 1).all()
  return inner.filter((token) => token.type === 'word').map(item)
}

/**
 * Skips a wrapper's options; returns where its command starts and the
 * options found, as { name, value }.
 */
function skipOptions(list, spec) {
  let k = 1
  const found = []
  while (k < list.length) {
    const arg = list[k].value
    if (arg === '--') {
      k += 1
      break
    }
    if (arg === '-' && spec.clears?.includes('-')) {
      found.push({ name: '-', value: null })
      k += 1
      continue
    }
    if (!arg.startsWith('-') || arg === '-') break
    if (spec.numeric && /^-\d+$/.test(arg)) {
      k += 1
      continue
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq < 0 ? arg : arg.slice(0, eq)
      if (eq < 0 && spec.long?.includes(name)) {
        found.push({
          name,
          value: list[k + 1]?.value ?? null,
        })
        k += 2
      } else {
        found.push({
          name,
          value: eq < 0 ? null : arg.slice(eq + 1),
        })
        k += 1
      }
      continue
    }
    let used = 1
    for (let p = 1; p < arg.length; p += 1) {
      const letter = arg[p]
      if (spec.valued?.includes(letter)) {
        const rest = arg.slice(p + 1)
        if (rest !== '') found.push({ name: `-${letter}`, value: rest })
        else {
          found.push({
            name: `-${letter}`,
            value: list[k + 1]?.value ?? null,
          })
          used = 2
        }
        break
      }
      found.push({ name: `-${letter}`, value: null })
    }
    k += used
  }
  return { next: k, found }
}

/**
 * One wrapper taken off the front of `list`, or null when list[0] is none
 * (or runs no command, like `command -v gh`).
 */
function unwrap(list, context) {
  const spec = wrappers.get(list[0].value)
  if (spec === undefined || !list[0].known) return null
  const { next, found } = skipOptions(list, spec)
  if (spec.stopIf && found.some((option) => spec.stopIf.includes(option.name)))
    return null
  let k = next + (spec.operands ?? 0)
  let rest = list.slice(k)
  let dir = context.dir
  const env = { ...context.env }
  for (const option of found) {
    // A variable env takes out is unset for the command: the parser writes
    // that as empty, as `unset` is (recordExports). Of what `-i` takes out,
    // only the variables the rules read are known by name (Copilot review
    // of #26, seventh round: the git config gh reads, and its repository).
    if (spec.clears?.includes(option.name))
      for (const name of clearedByEnv) env[name] = ''
    if (
      spec.unsets?.includes(option.name) &&
      option.value !== null &&
      watchedVariable.test(option.value)
    )
      env[option.value] = ''
    if (spec.chdir?.includes(option.name) && option.value !== null)
      dir = path.isAbsolute(option.value)
        ? path.normalize(option.value)
        : path.join(dir ?? '', option.value)
    if (spec.split?.includes(option.name) && option.value !== null)
      rest = [
        ...splitWords(option.value, context.state, context.depth),
        ...rest,
      ]
  }
  if (spec.assignments) {
    // env and sudo take NAME=value before the command, quoted or not.
    k = 0
    while (k < rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[k].value)) {
      const at = rest[k].value.indexOf('=')
      env[rest[k].value.slice(0, at)] = rest[k].value.slice(at + 1)
      k += 1
    }
    rest = rest.slice(k)
  }
  if (rest.length === 0) return null
  return { list: rest, dir, env, stdinConsumed: spec.stdinConsumed === true }
}

/**
 * The script a shell runs: the operand after `-c`, or null, and whether that
 * operand holds no expansion. `fromStdin` when it has no operand (or `-s`),
 * so it reads its script from stdin.
 */
function shellScript(list) {
  let k = 1
  let c = false
  let s = false
  while (k < list.length) {
    const arg = list[k].value
    if (arg === '--' || arg === '-') {
      k += 1
      break
    }
    if (arg.startsWith('--')) {
      k += arg === '--rcfile' || arg === '--init-file' ? 2 : 1
      continue
    }
    if ((arg.startsWith('-') || arg.startsWith('+')) && arg.length > 1) {
      let used = 1
      for (const letter of arg.slice(1)) {
        if (letter === 'c') c = true
        if (letter === 's') s = true
        if (letter === 'o' || letter === 'O') used += 1
      }
      k += used
      continue
    }
    break
  }
  if (c)
    return {
      script: list[k]?.value ?? null,
      known: list[k]?.known === true,
      fromStdin: false,
    }
  return { script: null, known: false, fromStdin: s || k >= list.length }
}

// ---------------------------------------------------------------------------
// Variables the line assigns
//
// `SP=/x; gh issue comment 8 --body-file "$SP/plano.md"` names a file the
// rules can read, and `R=ready-for-agent; gh issue edit 5 --add-label $R`
// adds a label they must see. So a variable the line itself assigns is
// filled in where the line uses it, the one expansion this parser performs,
// and only when its value there is certain:
// - a standalone `NAME=value` (or `export`/`readonly NAME=value`) assigned
//   it, one that runs for sure: at the top of the line, not inside a
//   compound command, a subshell or a pipeline, not after `&&` or `||`
//   (after `&&` only when what comes before it cannot fail: afterSureChain);
//   one after `&&` that may not run holds only for the rest of its `&&`
//   list (chainLocal in build);
// - that value is known in full;
// - nothing else on the line may assign the name: another assignment that
//   runs only maybe (in an `if`, a loop, a function, a subshell, after
//   `&&`), `read NAME`, `unset NAME`, `for NAME in`, `printf -v NAME`, any
//   word that spells it where a builtin could take it for a name. Such a
//   name is unknown on the whole line, since a loop or a function may run
//   that assignment before the use;
// - nothing before the use may assign names the line does not spell:
//   `eval`, `source`, a trap, an alias, a function definition, arithmetic,
//   a builtin that assigns with an argument it cannot read, a command whose
//   name is unknown, an IFS that is not only a `read`'s. From there on (from
//   the start of the line, when it sits inside a compound command or a
//   subshell) nothing is filled in.
// A name the line never assigns stays unknown: the hook's own environment is
// not the one the command runs in.
//
// A `for NAME in` loop over values written in full (`for k in a b c`,
// `for f in "$S/a" "$S/b"` with S known) is read as bash runs it: its body
// once per value, with NAME filled in there, when nothing in the body may
// assign NAME (loopOf). Its commands are listed once per value (Copilot
// review of #26, third round: a copy into `"docs/x-$k.json"` must be read
// for the write rules, not asked about). After the loop NAME stays unknown.

/** A name the shell keeps a variable under. */
const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A standalone assignment the line may count on: `NAME=value`, no `+=`, no subscript. */
const plainAssignment = /^[A-Za-z_][A-Za-z0-9_]*=/

/** An assignment of any kind, as a word's raw text starts it. */
const anyAssignment = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/

/**
 * Names the shell changes by itself, or whose assignment changes how the
 * rest of the line is read: never filled in. Compared lower-cased, which
 * also covers zsh's spelling of some of them (`status`, `reply`).
 */
const dynamicNames = new Set([
  '_',
  'bash_command',
  'bash_rematch',
  'bash_subshell',
  'bashpid',
  'dirstack',
  'epochrealtime',
  'epochseconds',
  'errno',
  'euid',
  'funcname',
  'groups',
  'histcmd',
  'histno',
  'ifs',
  'lineno',
  'mapfile',
  'match',
  'mbegin',
  'mend',
  'oldpwd',
  'optarg',
  'opterr',
  'optind',
  'pipestatus',
  'ppid',
  'pwd',
  'random',
  'reply',
  'seconds',
  'srandom',
  'status',
  'ttyidle',
  'uid',
  'zsh_subshell',
])

/** Builtins that run text of their own or assign names they do not spell. */
const evaluatorBuiltins = new Set([
  '.',
  'alias',
  'autoload',
  'emulate',
  'enable',
  'eval',
  'fc',
  'let',
  'r',
  'sched',
  'source',
  'trap',
  'unalias',
  'zmodload',
])

/** Builtins that assign the names among their arguments. */
const assigningBuiltins = new Set([
  'declare',
  'export',
  'float',
  'getopts',
  'integer',
  'local',
  'mapfile',
  'print',
  'printf',
  'read',
  'readarray',
  'readonly',
  'set',
  'typeset',
  'unset',
  'vared',
  'wait',
  'zparseopts',
])

/** Of those, the ones whose options change what they assign (`declare -n`). */
const declarers = new Set([
  'declare',
  'export',
  'float',
  'integer',
  'local',
  'readonly',
  'typeset',
])

/** Words before a command that still leave it a builtin of this shell. */
const precommands = new Set([
  'builtin',
  'command',
  'exec',
  'noglob',
  'nocorrect',
  'time',
])

/** Wrappers that run a command in this same shell (`command eval`). */
const sameShell = new Set(['builtin', 'command', 'noglob', 'nocorrect', 'time'])

/** Wrappers that hand the command the environment as they got it. */
const keepEnvironment = new Set([
  'caffeinate',
  'command',
  'exec',
  'gtimeout',
  'nice',
  'nocorrect',
  'noglob',
  'nohup',
  'setsid',
  'stdbuf',
  'time',
  'timeout',
])

/**
 * zsh ties these arrays to the scalars of the same name in capitals
 * (`path` to `PATH`): assigning one assigns the other, so they count as
 * one name.
 */
const tiedNames = new Set([
  'cdpath',
  'fignore',
  'fpath',
  'mailpath',
  'manpath',
  'module_path',
  'path',
  'psvar',
  'watch',
  'zsh_eval_context',
])

/** The name a variable is tracked under: its tied pair counted as one. */
const variableKey = (name) =>
  tiedNames.has(name.toLowerCase()) ? name.toLowerCase() : name

const blockOpeners = new Set(['if', 'while', 'until', '{'])
const blockClosers = new Set(['fi', 'done', '}', 'esac'])

/** Characters of a value that an unquoted expansion would split or glob. */
const unsafeUnquoted = /[\s*?[(]/

/**
 * A loop value the shell takes as written, quoted or not: nothing it would
 * split, glob, brace-expand or tilde-expand, nor zsh's leading `=`.
 */
const plainLoopValue = /^[A-Za-z0-9_./:@%+,-][A-Za-z0-9_./:@%+,=-]*$/

/**
 * How many units the `for` loops of one list may read again, once per
 * value: past it a loop is read once, its variable unknown. Enough for a
 * loop over a handful of files; a line crafted to multiply nested loops
 * stays linear.
 */
const maxLoopUnits = 512

/** Whether an arithmetic text may assign (`n=1`, `n+=1`, `n++`): any `=`, `++` or `--`. */
function arithmeticAssigns(text) {
  return /=|\+\+|--/.test(text)
}

/**
 * The word with its plain `$NAME` and `${NAME}` filled in from `vars`, or the
 * word as it is when one of them has no value there, or it holds any other
 * expansion. With `split`, an unquoted one whose value the shell would split,
 * glob or drop (blanks, `*`, `?`, `[`, `(`, empty) is not filled in either.
 * A filled-in word counts as quoted: an expansion is never a reserved word.
 */
function expandWord(word, vars, split = true) {
  if (
    word.known ||
    word.opaque ||
    !Array.isArray(word.refs) ||
    word.refs.length === 0 ||
    vars.size === 0
  )
    return word
  let value = word.value
  for (let k = word.refs.length - 1; k >= 0; k -= 1) {
    const ref = word.refs[k]
    const text = vars.get(ref.name)
    if (text === undefined) return word
    if (split && ref.split && (text === '' || unsafeUnquoted.test(text)))
      return word
    value = `${value.slice(0, ref.start)}${text}${value.slice(ref.end)}`
  }
  return { ...word, value, known: true, quoted: true, refs: [] }
}

/**
 * An assignment word (`NAME=value`) filled in: its value is not split, and a
 * `~` that starts it is the home directory, as bash and zsh read it. Any
 * other `~` there (`a:~/b`, `~user`) is not read, so the word is unknown.
 */
function expandAssignment(word, vars) {
  const rawValue = word.raw.slice(word.raw.indexOf('=') + 1)
  const result = expandWord(word, vars, false)
  if (/^~(?:\/|$)/.test(rawValue)) {
    const at = result.value.indexOf('=')
    return {
      ...result,
      value: `${result.value.slice(0, at + 1)}${os.homedir()}${result.value.slice(at + 2)}`,
    }
  }
  if (/^~|:~/.test(rawValue)) return { ...result, known: false, opaque: true }
  return result
}

/** A heredoc's body with its variables filled in, when they all have values. */
function expandHeredoc(heredoc, vars) {
  const body = heredoc.body ?? ''
  if (
    heredoc.known ||
    heredoc.opaque ||
    !Array.isArray(heredoc.refs) ||
    heredoc.refs.length === 0 ||
    vars.size === 0
  )
    return { body, known: heredoc.known }
  let text = body
  for (let k = heredoc.refs.length - 1; k >= 0; k -= 1) {
    const ref = heredoc.refs[k]
    const value = vars.get(ref.name)
    if (value === undefined) return { body, known: false }
    text = `${text.slice(0, ref.start)}${value}${text.slice(ref.end)}`
  }
  return { body: text, known: true }
}

/**
 * The words that open a simple command before the command itself: reserved
 * words (`then`, `!`, `{`), `function NAME`, and the prefixes that take any
 * command after them (`time [-p]`, `noglob`, `nocorrect`). `rest` is the
 * index where the rest starts.
 */
function headOf(words) {
  const reserved = []
  let k = 0
  while (k < words.length) {
    const word = words[k]
    if (!word.known || word.quoted) break
    if (reservedWords.has(word.value)) reserved.push(word.value)
    else if (word.value === 'function') {
      reserved.push('function')
      k += 1
    } else if (word.value === 'time') {
      while (words[k + 1]?.known && words[k + 1].value === '-p') k += 1
    } else if (word.value !== 'noglob' && word.value !== 'nocorrect') break
    k += 1
  }
  return { reserved, rest: k }
}

/**
 * Where the command's name stands among the words of a simple command: after
 * reserved words, assignments and the wrappers that keep a builtin a builtin
 * (`command`, `builtin`), with their options.
 */
function commandIndex(items) {
  let k = 0
  while (k < items.length) {
    const word = items[k]
    const bare = word.known && !word.quoted
    if (bare && (reservedWords.has(word.value) || word.value === 'function'))
      k += word.value === 'function' ? 2 : 1
    else if (anyAssignment.test(word.raw ?? '')) k += 1
    else if (bare && precommands.has(word.value)) {
      k += 1
      while (k < items.length && items[k].known && /^-./.test(items[k].value))
        k += 1
    } else break
  }
  return k
}

/**
 * Why a command may assign variables the line does not spell, or null:
 * 'name' when its name is unknown; 'evaluator' when it runs text of its own
 * (`eval`, `source`, `trap`, `mapfile -C`…); 'options' for a declaring
 * builtin with options (`declare -n`, `export -f`); 'argument' for a builtin
 * that assigns with an argument whose name is unknown (`read "$N"`, or
 * `printf "$F"`, whose format could be a `-v`).
 */
function riskOf(items) {
  const k = commandIndex(items)
  const head = items[k]
  if (head === undefined) return null
  if (!head.known) return 'name'
  const name = head.value
  if (evaluatorBuiltins.has(name)) return 'evaluator'
  if (!assigningBuiltins.has(name)) return null
  const args = items.slice(k + 1)
  if (name === 'printf' || name === 'print' || name === 'wait') {
    // They assign only with -v NAME (wait: -p NAME).
    const flag = name === 'wait' ? 'p' : 'v'
    for (const [j, word] of args.entries()) {
      if (!word.known) return 'argument'
      if (word.value === '--' || !/^-./.test(word.value)) return null
      if (word.value.endsWith(flag) && args[j + 1]?.known === false)
        return 'argument'
    }
    return null
  }
  if (
    declarers.has(name) &&
    args.some((word) => word.known && /^[-+]./.test(word.value))
  )
    return 'options'
  if (
    (name === 'mapfile' || name === 'readarray') &&
    args.some((word) => word.known && /^-[A-Za-z]*C/.test(word.value))
  )
    return 'evaluator'
  if (args.some((word) => !word.known && !plainAssignment.test(word.raw ?? '')))
    return 'argument'
  return null
}

/**
 * The variable names a word may assign, for any builtin that takes it: its
 * own assignment (`NAME=`, `NAME+=`, `NAME[..]=`), and, when its value is
 * known, a bare name (`read NAME`, `unset NAME`, `for NAME in`), a name
 * before `=` (`declare "NAME=x"`), `{NAME}` (bash's `{fd}>file`), `-vNAME`,
 * and a name after `=` (`zparseopts h=NAME`).
 */
function mentionsOf(word) {
  const names = []
  const own = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[|\+?=)/.exec(word.raw ?? '')
  if (own !== null) names.push(own[1])
  if (word.known)
    for (const pattern of [
      /^([A-Za-z_][A-Za-z0-9_]*)(?:\[|\+?=|$)/,
      /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/,
      /^-[vpaA]([A-Za-z_][A-Za-z0-9_]*)$/,
      /=([A-Za-z_][A-Za-z0-9_]*)$/,
    ]) {
      const match = pattern.exec(word.value)
      if (match !== null) names.push(match[1])
    }
  return names
}

/**
 * The names a unit may assign, for a loop's body (loopOf): those its
 * assignments before the command spell, a `{NAME}` before a redirection
 * (bash's `exec {fd}>file`), and, for a builtin that assigns or a
 * `for`/`select` header, every name any of its words spells (mentionsOf).
 * An argument of any other command assigns nothing in this shell (`gh api
 * -F n=$n`). A command whose name is unknown, or one that runs text of its
 * own (`eval`), stops the filling in for the whole line (analyze): no loop
 * gets here with one in its body.
 */
function namesAssignedBy(words) {
  const k = commandIndex(words)
  const head = words[k]
  const spelling =
    head !== undefined &&
    (assigningBuiltins.has(head.value) || headerWords.has(head.value))
      ? words
      : [
          ...words.slice(0, k),
          ...words.filter(
            (word) =>
              word.known && /^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(word.value),
          ),
        ]
  return spelling.flatMap(mentionsOf)
}

/**
 * Whether a unit, at the top of the line, cannot fail: a plain assignment
 * of known values, or a `cd` to an absolute directory that exists.
 */
function cannotFail(unit) {
  if (
    unit === null ||
    !unit.own ||
    unit.blocks > 0 ||
    unit.scopes > 0 ||
    unit.head.rest > 0 ||
    unit.redirs.length > 0 ||
    unit.words.length === 0 ||
    !unit.words.every((word) => word.known)
  )
    return false
  if (unit.words.every((word) => plainAssignment.test(word.raw))) return true
  const [name, dir, ...rest] = unit.words
  if (!isBare(name, 'cd') || dir === undefined || rest.length > 0) return false
  if (!path.isAbsolute(dir.value)) return false
  try {
    return statSync(dir.value).isDirectory()
  } catch {
    return false
  }
}

/**
 * Whether an assignment after `&&` runs for sure (Copilot review of #26,
 * third round: `cd "$W" && S=/x && cat > "$S/m" <<EOF` then `git commit -F
 * "$S/m"` on the next line): every unit before it in its and-or list is
 * joined by `&&` and cannot fail, so the list reaches it whenever the line
 * runs, and the lines after it see its value.
 */
function afterSureChain(unit) {
  const { chain, chainLength } = unit
  if (chainLength === 0) return false
  // sure[k]: the first k entries all cannot fail and are joined by `&&`.
  // Read once per list (the list is settled when the units are analyzed),
  // so a line of many `&&` stays linear.
  chain.sure ??= [true]
  while (chain.sure.length <= chainLength) {
    const k = chain.sure.length
    const entry = chain[k - 1]
    chain.sure.push(
      chain.sure[k - 1] && entry.op === '&&' && cannotFail(entry.unit),
    )
  }
  return chain.sure[chainLength]
}

/**
 * Whether a unit is an assignment the line may count on, and which kind:
 * 'assign' (`A=1 B=2`), 'export' or 'readonly' (`export A=1 B`), or null.
 */
function definiteShape(unit) {
  const { words } = unit
  if (
    words.length === 0 ||
    unit.blocks > 0 ||
    unit.scopes > 0 ||
    (unit.andOr && !afterSureChain(unit)) ||
    !unit.own ||
    unit.head.rest > 0
  )
    return null
  if (words.every((word) => plainAssignment.test(word.raw))) return 'assign'
  const first = words[0]
  if (
    words.length > 1 &&
    (isBare(first, 'export') || isBare(first, 'readonly')) &&
    words
      .slice(1)
      .every(
        (word) =>
          plainAssignment.test(word.raw) ||
          (word.known && !word.quoted && variableName.test(word.value)),
      )
  )
    return first.value
  return null
}

/** The name a word of a definite unit assigns (or exports), or null. */
function ownName(unit, k, word) {
  if (unit.definite === null || (unit.definite !== 'assign' && k === 0))
    return null
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(word.raw)
  if (match !== null) return match[1]
  return word.known && variableName.test(word.value) ? word.value : null
}

/** Builtins that read a line and split it with IFS, and assign nothing else with a prefix. */
const ifsReaders = new Set(['read', 'mapfile', 'readarray'])

/**
 * Whether word k of a unit is an assignment in the environment of a `read`
 * (`IFS= read -r f`): regular builtins keep such an assignment to
 * themselves, in bash and in zsh.
 */
function onlyForRead(unit, k) {
  const at = commandIndex(unit.words)
  const head = unit.words[at]
  return (
    k < at &&
    anyAssignment.test(unit.words[k].raw ?? '') &&
    isBare(head, head?.value) &&
    ifsReaders.has(head.value)
  )
}

/**
 * What the line may do to its variables, before any is filled in: the names
 * that something other than a definite assignment may assign (`unstable`,
 * by variableKey), and the index of the first unit from which nothing is
 * filled in (`opaqueFrom`). Each unit gets `definite` (definiteShape) and
 * `recheck`, when only its expanded name can tell whether it is risky.
 */
function analyze(units, marks) {
  const unstable = new Set()
  let opaqueFrom = Number.POSITIVE_INFINITY
  for (const at of marks) opaqueFrom = Math.min(opaqueFrom, at)
  for (const unit of units) {
    const { index, words, redirs } = unit
    const inBlock = unit.blocks > 0 || unit.scopes > 0
    // From this unit on (an expansion that assigns, a function body), or
    // from the next one (a command runs once its words are expanded).
    const mark = (after = false) => {
      opaqueFrom = Math.min(opaqueFrom, inBlock ? 0 : index + (after ? 1 : 0))
    }
    if (unit.head.reserved.includes('function')) mark()
    if (
      words.some((word) => word.assigns) ||
      redirs.some((redir) => redir.target?.assigns || redir.heredoc?.assigns)
    )
      mark()
    unit.definite = definiteShape(unit)
    unit.recheck = false
    for (const [k, word] of words.entries()) {
      const own = ownName(unit, k, word)
      for (const name of mentionsOf(word)) {
        // IFS changes how every unquoted expansion splits, unless it is only
        // the environment of a `read` (`while IFS= read -r f`), which splits
        // its own input with it and changes nothing else (Copilot review of
        // #26, third round).
        if (name === 'IFS' && !onlyForRead(unit, k)) opaqueFrom = 0
        if (name !== own) unstable.add(variableKey(name))
      }
    }
    const risk = riskOf(words)
    if (risk === null) continue
    const k = commandIndex(words)
    if (
      risk === 'name' &&
      !inBlock &&
      !words[k].opaque &&
      words.slice(k + 1).every((word) => word.known)
    )
      unit.recheck = true
    else mark(true)
  }
  return { unstable, opaqueFrom }
}

// ---------------------------------------------------------------------------
// Simple commands, in the order the line runs them

/**
 * One simple command from its words and redirections: the SimpleCommand, the
 * commands it runs besides itself (substitutions, `bash -c`, `eval`), its
 * effect on the directory (`cd`), what it assigns when it is a standalone
 * assignment (`assigned`) or an `export`/`readonly` (`declared`), and its
 * riskOf once its words are filled in.
 *
 * `context.vars` are the variables known where it runs (see "Variables the
 * line assigns"); `context.exported`, the names the line exported;
 * `context.active` false once nothing is filled in any more.
 */
function simple(unit, given, redirs, context) {
  const { state, depth, env: inherited, piped, vars, exported } = context
  // A `"$(cat <<EOF … EOF)"` the lexer read as its text holds that text only
  // while `cat` is the program. Once the line may have defined a function or
  // an alias (a function definition, eval, source: what ends `active`), or
  // this runs inside such a line (`trusted` false), it may be anything: the
  // word goes back to its raw text, unknown, `$` and all.
  const trusted = context.active !== false && context.trusted !== false
  const distrust = (word) =>
    word.cat && !trusted
      ? { ...word, value: word.raw, known: false, opaque: true, refs: [] }
      : word
  const words = given.map(distrust)
  const extra = []
  const none = new Map()
  const run = (sub, dir, env, subVars = vars, subExported = exported) =>
    extra.push(
      ...build(sub, {
        state,
        depth: depth + 1,
        cwd: dir,
        env: env ?? inherited,
        vars: subVars,
        exported: subExported,
        trusted,
      }),
    )
  const script = (text, dir, env, subVars, subExported) => {
    if (depth + 1 > maxDepth) throw new DepthLimit()
    const tokens = lexer(text, state, depth + 1).all()
    run({ src: text, tokens }, dir, env, subVars, subExported)
  }

  // Substitutions run first, in the directory the command starts in.
  for (const word of words) for (const sub of word.subs) run(sub, context.cwd)
  for (const redir of redirs) {
    for (const sub of redir.target?.subs ?? []) run(sub, context.cwd)
    for (const sub of redir.heredoc?.subs ?? []) run(sub, context.cwd)
  }

  // The words filled in. An assignment before the command's name sees the
  // ones to its left (`A=1 B=$A`), as bash and zsh read it, and so does a
  // standalone one; the command's own words see the variables from before.
  // A declaring builtin's `NAME=value` arguments are read like assignments.
  const assigned = []
  const local = new Map(vars)
  let leading = true
  let declaring = false
  const expanded = words.map((word) => {
    if (leading && word.known && !word.quoted && reservedWords.has(word.value))
      return word
    if (leading && assignment.test(word.raw)) {
      const filled = expandAssignment(word, local)
      const at = filled.value.indexOf('=')
      const name = filled.value.slice(0, at).replace(/\+$/, '')
      const value = filled.value.slice(at + 1)
      assigned.push({ name, value, known: filled.known })
      if (filled.known && !word.raw.startsWith(`${name}+=`))
        local.set(name, value)
      else local.delete(name)
      return filled
    }
    if (leading) {
      leading = false
      declaring = isBare(word, word.value) && declarers.has(word.value)
      return expandWord(word, vars)
    }
    return declaring && assignment.test(word.raw)
      ? expandAssignment(word, vars)
      : expandWord(word, vars)
  })
  const risk = riskOf(expanded)
  const targets = redirs.map((redir) =>
    redir.target === null
      ? null
      : expandWord(distrust(redir.target), vars, redir.op !== '<<<'),
  )

  // stdin: a pipe unless a redirection says otherwise; the last one wins.
  let stdin = null
  let stdinKnown = false
  let stdinFile = null
  for (const [index, redir] of redirs.entries()) {
    if (!redir.op.startsWith('<') || (redir.fd !== null && redir.fd !== '0'))
      continue
    const target = targets[index]
    stdin = null
    stdinKnown = false
    stdinFile = null
    if (redir.heredoc) {
      const heredoc = expandHeredoc(redir.heredoc, vars)
      stdin = heredoc.body
      stdinKnown = heredoc.known && (trusted || redir.heredoc.cat !== true)
    } else if (redir.op === '<<<' && target) {
      stdin = `${target.value}\n`
      stdinKnown = target.known
    } else if ((redir.op === '<' || redir.op === '<>') && target?.known)
      stdinFile = target.value
  }
  if (piped && redirs.every((redir) => !redir.op.startsWith('<'))) {
    stdin = null
    stdinKnown = false
  }

  let list = expanded.map(item)
  let env = { ...inherited }
  let dir = context.cwd
  const childEnv = new Map()
  const wrapped = []
  const normalizeHead = () => {
    const head = list[0]
    if (head?.known && head.value.includes('/') && !head.value.endsWith('/'))
      list[0] = { ...head, value: path.basename(head.value) }
  }
  const done = (command, cd = null, declared = []) => ({
    command,
    extra,
    cd,
    assigned,
    declared,
    risk,
  })

  for (let round = 0; round < 64 && list.length > 0; round += 1) {
    while (list.length > 0 && list[0].known && !list[0].quoted) {
      const head = list[0].value
      if (reservedWords.has(head)) list.shift()
      else if (head === 'function') list.splice(0, 2)
      else break
    }
    if (
      list.length > 0 &&
      isBare(list[0], list[0].value) &&
      headerWords.has(list[0].value)
    )
      return done(null)
    while (list.length > 0 && assignment.test(list[0].raw)) {
      const at = list[0].value.indexOf('=')
      const name = list[0].value.slice(0, at).replace(/\+$/, '')
      env[name] = list[0].value.slice(at + 1)
      childEnv.set(name, list[0].known ? env[name] : null)
      list.shift()
    }
    if (list.length === 0) break
    normalizeHead()
    const wrapper = list[0].value
    const unwrapped = unwrap(list, { dir, env, state, depth })
    if (unwrapped === null) break
    wrapped.push(wrapper)
    list = unwrapped.list
    dir = unwrapped.dir
    env = unwrapped.env
    if (unwrapped.stdinConsumed) {
      stdin = null
      stdinKnown = false
      stdinFile = null
    }
  }
  if (list.length === 0) return done(null)
  normalizeHead()

  const name = list[0].known ? list[0].value : null
  if (shells.has(name)) {
    // A shell started here sees the variables exported to it: the line's
    // exports and the assignments before it. Only when its script holds no
    // expansion of this line: what this line left unread must not be read
    // there with a value it does not have here.
    const childVars = (known) => {
      const out = new Map()
      if (
        !known ||
        context.active === false ||
        !wrapped.every((w) => keepEnvironment.has(w))
      )
        return out
      for (const [key, value] of vars)
        if (exported.has(key)) out.set(key, value)
      for (const [key, value] of childEnv)
        if (value === null) out.delete(key)
        else out.set(key, value)
      return out
    }
    const found = shellScript(list)
    if (found.script !== null) {
      const own = childVars(found.known)
      script(found.script, dir, env, own, new Set(own.keys()))
    } else if (found.fromStdin && stdin !== null) {
      const own = childVars(stdinKnown)
      script(stdin, dir, env, own, new Set(own.keys()))
    }
  }
  if (name === 'eval' && list.length > 1) {
    // eval runs in this same shell: its text sees this shell's variables.
    const args = list.slice(1)
    const same =
      args.every((word) => word.known) && wrapped.every((w) => sameShell.has(w))
    script(
      args.map((word) => word.value).join(' '),
      dir,
      env,
      same ? vars : none,
      same ? exported : new Set(),
    )
  }

  const cd =
    name === 'cd' || name === 'pushd' || name === 'popd'
      ? { name, args: list.slice(1) }
      : null

  const declared = []
  if ((name === 'export' || name === 'readonly') && wrapped.length === 0)
    for (const word of list.slice(1)) {
      if (plainAssignment.test(word.raw)) {
        const at = word.value.indexOf('=')
        declared.push({
          name: word.value.slice(0, at),
          value: word.value.slice(at + 1),
          known: word.known,
        })
      } else if (word.known && variableName.test(word.value))
        declared.push({ name: word.value, value: null, known: true })
    }

  return done(
    {
      argv: list.map((word) => word.value),
      env,
      cwd: dir,
      stdin,
      text: unit.text,
      known: list.map((word) => word.known),
      stdinKnown,
      stdinFile,
      redirs: redirs.flatMap((redir, index) =>
        redir.heredoc || targets[index] === null
          ? []
          : [
              {
                op: redir.op,
                fd: redir.fd,
                target: {
                  value: targets[index].value,
                  known: targets[index].known,
                },
              },
            ],
      ),
    },
    cd,
    declared,
  )
}

/**
 * The token list cut into simple commands (units), in order, each with where
 * it sits: inside how many compound commands (`blocks`) and subshells
 * (`scopes`), whether it runs in a shell of its own (`own` false: a
 * pipeline, `&`), whether it runs only maybe (`andOr`: after `&&` or `||`).
 * Between them, `open` and `close` for a subshell's parentheses and `drain`
 * for words that run only their substitutions (a `case` header, a pattern).
 * `marks` are unit indexes from which the line may assign names it does not
 * spell: a function definition (`NAME ( )`), and `((...))` (from the start).
 */
function segment(src, tokens, state) {
  const events = []
  const units = []
  const marks = []
  const scopes = []
  let caseDepth = 0
  let blocks = 0
  let words = []
  let redirs = []
  let first = null
  let last = null
  let before = null
  let item = false
  let andOr = false
  let previous = null
  // The and-or list the next unit belongs to: each unit before it with the
  // operator after it, and a null unit for what is no plain unit there (a
  // subshell, a pipeline). Emptied where a list ends.
  let chain = []

  const flush = (after) => {
    if (words.length === 0 && redirs.length === 0) return false
    const piped = before === '|' || before === '|&'
    const own = !(piped || after === '|' || after === '|&' || after === '&')
    const head = headOf(words)
    for (const word of head.reserved)
      if (blockOpeners.has(word)) blocks += 1
      else if (blockClosers.has(word)) {
        blocks = Math.max(0, blocks - 1)
        if (word === 'esac') caseDepth = Math.max(0, caseDepth - 1)
      }
    const unit = {
      index: units.length,
      words,
      redirs,
      text: src.slice(first, last),
      piped,
      own,
      andOr,
      blocks,
      scopes: scopes.length,
      head,
      // The entries before this unit are settled once it is read: only the
      // last entry of a list takes the operator after it. So the list is
      // shared, not copied, which keeps a line of many `&&` linear.
      chain,
      chainLength: andOr ? chain.length : 0,
    }
    chain.push({ unit, op: null })
    // `for x in …` and `select` open a loop that `done` closes.
    const header = words[head.rest]
    if (isBare(header, header?.value) && headerWords.has(header.value))
      blocks += 1
    units.push(unit)
    events.push({ kind: 'unit', unit })
    words = []
    redirs = []
    first = null
    return true
  }

  // Inside `case WORD in`, the words up to `)` are a pattern: they select a
  // branch and run nothing, and a `|` there separates alternatives, not a
  // pipeline. A pattern is expected after the header and after each `;;`.
  let pattern = false
  let patternWords = []
  const caseFloor = () => scopes.at(-1)?.caseDepth ?? 0

  for (const token of tokens) {
    const prior = previous
    previous = token
    if (pattern) {
      if (
        token.type === 'word' &&
        patternWords.length === 0 &&
        isBare(token, 'esac')
      ) {
        caseDepth = Math.max(0, caseDepth - 1)
        blocks = Math.max(0, blocks - 1)
        pattern = false
        item = true
        before = null
      } else if (token.type === 'word') patternWords.push(token)
      else if (token.type === 'op' && token.op === ')') {
        events.push({ kind: 'drain', words: patternWords })
        patternWords = []
        pattern = false
        item = false
        before = ')'
      }
      // `|`, a leading `(` and newlines belong to the pattern.
      continue
    }
    if (token.type !== 'op') {
      if (first === null) first = token.start
      last = token.end
      if (token.type === 'word') words.push(token)
      else redirs.push(token)
      if (
        words.length === 3 &&
        redirs.length === 0 &&
        isBare(words[0], 'case') &&
        isBare(words[2], 'in')
      ) {
        // `case WORD in`: a header that runs nothing; patterns follow.
        events.push({ kind: 'drain', words })
        words = []
        first = null
        caseDepth += 1
        blocks += 1
        pattern = true
        item = false
      }
      continue
    }
    const { op } = token
    if (flush(op)) item = true
    if (branchEnds.has(op) && caseDepth > caseFloor()) {
      pattern = true
      item = false
      andOr = false
      chain = []
      before = op
      continue
    }
    if (op === '(') {
      chain.push({ unit: null, op: null })
      // `((…))` is arithmetic, which may assign any name.
      if (prior?.type === 'op' && prior.op === '(' && prior.end === token.start)
        marks.push(0)
      scopes.push({ caseDepth, blocks })
      events.push({ kind: 'open' })
      item = false
    } else if (op === ')') {
      if (scopes.length === 0) state.unparsable = true
      else {
        ;({ blocks } = scopes.pop())
        events.push({ kind: 'close' })
        // `NAME ( )` defines a function (`( )` alone, zsh's anonymous one):
        // its body runs whenever it is called, and may assign anything.
        if (prior?.type === 'op' && prior.op === '(')
          marks.push(blocks > 0 || scopes.length > 0 ? 0 : units.length)
      }
      item = true
    } else if (op === '\n') {
      // A newline after `&&` or `|` continues the list.
      if (!item && binaryOperators.has(before)) continue
      item = false
      andOr = false
      chain = []
    } else {
      // `&&`, `;` and the rest need a command before them.
      if (!item) state.unparsable = true
      item = false
      if (op === '&&' || op === '||' || op === '|' || op === '|&') {
        if (chain.length === 0) chain.push({ unit: null, op: null })
        chain.at(-1).op = op
      } else chain = []
      if (op === '&&' || op === '||') andOr = true
      else if (op !== '|' && op !== '|&') andOr = false
    }
    before = op
  }
  if (pattern && patternWords.length > 0) state.unparsable = true
  if (!flush(null) && binaryOperators.has(before)) state.unparsable = true
  if (scopes.length > 0) state.unparsable = true
  return { events, units, marks }
}

/**
 * The `for NAME in VALUES…` loop whose header is the unit of events[k], when
 * its body can be read once per value (see "Variables the line assigns"):
 * { name, values, end, units, carried }, `end` being the index of the event
 * of the `done` that closes it, `units` how many units its body has, and
 * `carried` the variables known at the header that no unit of the body may
 * assign. The body runs only once the header ran, so a value that holds
 * there holds in it: one assigned earlier in the header's `&&` list
 * (`S=/x && for n in 1 2; do … > "$S/$n.json"; done`) included. null when
 * the unit is no such header; when a value is not known in full, or is one
 * the shell would split, glob or expand (plainLoopValue); when NAME is one
 * the shell changes by itself; when a unit of the body may assign NAME; or
 * when reading the body once per value would take more than `budget` units.
 * `vars` are the variables known at the header.
 */
function loopOf(events, k, vars, budget) {
  const { words, redirs, head, blocks } = events[k].unit
  const at = head.rest
  const name = words[at + 1]
  if (
    redirs.length > 0 ||
    !isBare(words[at], 'for') ||
    name === undefined ||
    !name.known ||
    name.quoted ||
    !variableName.test(name.value) ||
    dynamicNames.has(name.value.toLowerCase()) ||
    tiedNames.has(name.value.toLowerCase()) ||
    !isBare(words[at + 2], 'in')
  )
    return null
  const values = []
  for (const word of words.slice(at + 3)) {
    // A substitution, `"$(cat <<EOF … EOF)"` included, runs at the header.
    if (word.subs.length > 0) return null
    const filled = expandWord(word, vars)
    if (!filled.known || !plainLoopValue.test(filled.value)) return null
    values.push(filled.value)
  }
  if (values.length === 0) return null
  // The body is every unit deeper than the header, up to the first back at
  // its level, which is the `done` that closes it; the subshells in it
  // close in it. The search stops once the body is past the budget, so
  // that the loops of a line are read in linear time whatever they nest.
  let depth = 0
  let units = 0
  const mentioned = new Set()
  for (let e = k + 1; e < events.length; e += 1) {
    if ((e - k) * values.length > budget) return null
    const event = events[e]
    if (event.kind === 'open') depth += 1
    if (event.kind === 'close' && --depth < 0) return null
    if (event.kind !== 'unit') continue
    const unit = event.unit
    if (unit.blocks > blocks) {
      for (const mention of namesAssignedBy(unit.words))
        mentioned.add(variableKey(mention))
      units += 1
      continue
    }
    if (depth !== 0 || !unit.head.reserved.includes('done')) return null
    if (mentioned.has(variableKey(name.value))) return null
    const carried = new Map(
      [...vars].filter(([known]) => !mentioned.has(variableKey(known))),
    )
    return { name: name.value, values, end: e, units, carried }
  }
  return null
}

/**
 * The simple commands of a token list, in order, then the commands they run
 * besides themselves. `cd` moves the rest of the same shell: across `;`,
 * `&&`, `||` and newlines, but not out of a subshell `( )`, a pipeline or a
 * command sent to the background, which run in a shell of their own. The
 * variables the line assigns are filled in as "Variables the line assigns"
 * says, starting from `context.vars` (those of the shell this list runs in).
 */
function build(unit, context) {
  const { src, tokens } = unit
  const { state, depth } = context
  const { events, units, marks } = segment(src, tokens, state)
  const plan = analyze(units, marks)
  const trackable = (name) =>
    !plan.unstable.has(variableKey(name)) &&
    !dynamicNames.has(name.toLowerCase())
  const vars = new Map()
  for (const [name, value] of context.vars ?? [])
    if (trackable(name)) vars.set(name, value)
  const exported = new Set(context.exported ?? [])
  const none = new Map()
  const out = []
  const later = []
  const scopes = []
  const stack = []
  // Standalone assignments (`HOME=/x;`) since the last command: the next
  // command carries them as assignedBefore, for recordAssignments.
  let assignedSince = []
  let cwd = context.cwd
  let previous
  let next = 0

  const visible = () => (next < plan.opaqueFrom ? vars : none)

  // Assignments that hold for the rest of their `&&` list (Copilot review of
  // #26, third round: `git commit … && SP=/x && npm run check > $SP/log`).
  // One after a command that may fail is not certain for the lines after
  // it, but every unit after it in the same list, joined by `&&` alone, runs
  // only once it ran. Per list: [{ name, value, at }], `at` being its entry.
  const chainLocal = new Map()
  const withChain = (unit) => {
    const local = chainLocal.get(unit.chain)
    if (local === undefined || unit.chainLength === 0) return vars
    let merged = null
    for (const { name, value, at } of local) {
      if (at >= unit.chainLength) continue
      let holds = true
      for (let k = at; k < unit.chainLength && holds; k += 1) {
        const entry = unit.chain[k]
        holds =
          entry.op === '&&' &&
          (k === at ||
            (entry.unit !== null &&
              !entry.unit.words.some((word) =>
                mentionsOf(word).includes(name),
              )))
      }
      if (!holds) continue
      merged ??= new Map(vars)
      merged.set(name, value)
    }
    return merged ?? vars
  }
  const pureAssignment = (unit) =>
    unit.andOr &&
    unit.own &&
    unit.blocks === 0 &&
    unit.scopes === 0 &&
    unit.head.rest === 0 &&
    unit.words.length > 0 &&
    unit.words.every((word) => plainAssignment.test(word.raw))

  const moveTo = (target) => {
    const to = path.isAbsolute(target)
      ? path.normalize(target)
      : path.join(cwd ?? '', target)
    previous = cwd
    cwd = to
  }

  const applyCd = ({ name, args }) => {
    const operands = []
    let options = true
    for (const arg of args) {
      if (options && arg.value === '--') options = false
      else if (options && /^-[LPe@]+$/.test(arg.value)) continue
      else operands.push(arg)
    }
    if (name === 'popd') {
      if (stack.length > 0) {
        previous = cwd
        cwd = stack.pop()
      }
      return
    }
    const target = operands[0]
    if (name === 'pushd') {
      if (target === undefined) {
        // `pushd` alone swaps the two top directories.
        if (stack.length > 0) {
          const top = stack.pop()
          stack.push(cwd)
          previous = cwd
          cwd = top
        }
        return
      }
      stack.push(cwd)
    }
    if (target === undefined) return moveTo(os.homedir())
    if (target.value === '-' && name === 'cd') {
      // OLDPWD: known only after a cd of this line.
      if (previous !== undefined) {
        const back = previous
        previous = cwd
        cwd = back
      }
      return
    }
    // A target with an expansion stays as written: resolved, it names no
    // existing directory, so the caller lands on the nearest existing one.
    moveTo(target.value)
  }

  // The values of the loops whose body is being read (loopOf), by name.
  const withLoops = (base, loops) => {
    if (loops.size === 0) return base
    const merged = new Map(base)
    for (const [name, value] of loops) merged.set(name, value)
    return merged
  }
  let loopUnits = 0

  // Events from..to-1, with `loops` filled in; a loop's body is walked once
  // per value, then the walk goes on from its `done`.
  const walk = (from, to, loops) => {
    for (let k = from; k < to; k += 1) {
      const event = events[k]
      if (event.kind === 'unit') {
        const loop = unitEvent(k, loops)
        if (loop === null) continue
        for (const value of loop.values)
          walk(k + 1, loop.end, new Map([...loop.carried, [loop.name, value]]))
        k = loop.end - 1
      } else otherEvent(event, loops)
    }
  }

  const otherEvent = (event, loops) => {
    if (event.kind === 'open') {
      scopes.push({ cwd, previous })
      return
    }
    if (event.kind === 'close') {
      ;({ cwd, previous } = scopes.pop())
      return
    }
    // drain
    for (const word of event.words)
      for (const sub of word.subs)
        later.push(
          ...build(sub, {
            ...context,
            depth: depth + 1,
            cwd,
            vars: withLoops(visible(), next < plan.opaqueFrom ? loops : none),
            exported,
            trusted: context.trusted !== false && next < plan.opaqueFrom,
          }),
        )
  }

  /**
   * Reads the unit of events[k]; returns the loop it opens when its body is
   * read once per value, within maxLoopUnits.
   */
  const unitEvent = (k, loops) => {
    const current = events[k].unit
    next = current.index
    const active = next < plan.opaqueFrom
    const seen = active ? withLoops(withChain(current), loops) : none
    const result = simple(
      { text: current.text },
      current.words,
      current.redirs,
      {
        state,
        depth,
        cwd,
        env: context.env,
        piped: current.piped,
        vars: seen,
        active,
        exported,
        trusted: context.trusted,
      },
    )
    if (result.command !== null) {
      // Not enumerable: a copy of the command ({ ...command }) is a command
      // of its own, and only the caller that reads the line in order, before
      // judging each command, applies it.
      if (assignedSince.length > 0)
        Object.defineProperty(result.command, 'assignedBefore', {
          value: assignedSince,
          enumerable: false,
        })
      assignedSince = []
      out.push(result.command)
    } else assignedSince = [...assignedSince, ...result.assigned]
    later.push(...result.extra)
    if (active) {
      if (current.recheck && result.risk !== null)
        plan.opaqueFrom = Math.min(plan.opaqueFrom, current.index + 1)
      if (current.definite !== null)
        for (const { name, value, known } of current.definite === 'assign'
          ? result.assigned
          : result.declared) {
          if (current.definite === 'export') exported.add(name)
          if (value === null || !trackable(name)) continue
          if (known) vars.set(name, value)
          else vars.delete(name)
        }
      else if (pureAssignment(current)) {
        const local = chainLocal.get(current.chain) ?? []
        for (const { name, value, known } of result.assigned)
          if (known && !dynamicNames.has(name.toLowerCase()))
            local.push({ name, value, at: current.chainLength })
        chainLocal.set(current.chain, local)
      }
    }
    if (current.own && result.cd !== null) applyCd(result.cd)
    next = current.index + 1
    if (!active) return null
    const loop = loopOf(events, k, seen, maxLoopUnits - loopUnits)
    if (loop !== null) loopUnits += loop.values.length * loop.units
    return loop
  }

  walk(0, events.length, new Map())
  return [...out, ...later]
}

/**
 * @typedef {{
 *   argv: string[],
 *   env: Record<string, string>,
 *   cwd: string | null,
 *   stdin: string | null,
 *   text: string,
 *   known: boolean[],
 *   stdinKnown: boolean,
 *   stdinFile: string | null,
 *   redirs: { op: string, fd: string | null, target: { value: string, known: boolean } }[],
 * }} SimpleCommand
 * `cwd` is null when no `cd` came before (the caller's directory), else the
 * directory as the line wrote it, relative to the caller's or absolute; the
 * caller resolves it. `known[k]` says whether argv[k] holds no expansion.
 * `stdin` is a heredoc's or a here-string's text, and `stdinKnown` whether
 * that text holds no expansion; `stdinFile` is the file of a `<` redirection.
 * `redirs` are its redirections other than heredocs, with their targets
 * filled in like its words (`>&2` included: its target is `2`).
 */

/**
 * @returns {{ commands: SimpleCommand[], unparsable: boolean, substitution: boolean }}
 * The commands in order, then those run inside substitutions, `bash -c`
 * scripts and `eval`. `unparsable` when the text is not all read (an
 * unterminated quote, substitution or heredoc, a syntax error, or nesting
 * past maxDepth), with the commands that could be read.
 */
export function parseCommand(text) {
  const state = { unparsable: false, substitution: false }
  if (typeof text !== 'string')
    return { commands: [], unparsable: true, substitution: false }
  try {
    const tokens = lexer(text, state, 0).all()
    const commands = build(
      { src: text, tokens },
      {
        state,
        depth: 0,
        cwd: null,
        env: {},
        vars: new Map(),
        exported: new Set(),
      },
    )
    return { commands, ...state }
  } catch (error) {
    if (!(error instanceof DepthLimit)) throw error
    return { commands: [], unparsable: true, substitution: state.substitution }
  }
}

// ---------------------------------------------------------------------------
// Options, for the rules

/**
 * Every occurrence of the given options in argv, as { name, value, index },
 * where `index` is the argv index that holds the value. Long options as
 * `--opt value` and `--opt=value`; single-letter ones as `-o value`,
 * `-ovalue` and `-o=value` (gh's flag parser drops the `=`). The value is
 * taken whatever it looks like, as gh's parser takes it; an option with no
 * value after it is left out. Parsing stops at `--`. With `abbreviations`, a
 * long option also matches its prefixes of three letters or more, as git
 * accepts them (`--mess` for `--message`).
 */
export function findOptions(argv, names, { abbreviations = false } = {}) {
  const long = names.filter((name) => name.startsWith('--'))
  const short = names.filter((name) => /^-[^-]$/.test(name))
  const found = []
  for (let k = 0; k < argv.length; k += 1) {
    const arg = String(argv[k])
    if (arg === '--') break
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq < 0 ? arg : arg.slice(0, eq)
      const name =
        long.find((candidate) => candidate === key) ??
        (abbreviations && key.length >= 5
          ? long.find((candidate) => candidate.startsWith(key))
          : undefined)
      if (name === undefined) continue
      if (eq >= 0) found.push({ name, value: arg.slice(eq + 1), index: k })
      else if (k + 1 < argv.length) {
        found.push({ name, value: String(argv[k + 1]), index: k + 1 })
        k += 1
      }
      continue
    }
    if (arg.length < 2 || arg[0] !== '-') continue
    const name = short.find((candidate) => arg.startsWith(candidate))
    if (name === undefined) continue
    if (arg.length > 2)
      found.push({
        name,
        value: arg[2] === '=' ? arg.slice(3) : arg.slice(2),
        index: k,
      })
    else if (k + 1 < argv.length) {
      found.push({ name, value: String(argv[k + 1]), index: k + 1 })
      k += 1
    }
  }
  return found
}

/** Every value of the given short/long options, in order (findOptions). */
export function optionValues(argv, names, options) {
  return findOptions(argv, names, options).map((option) => option.value)
}

/** The most a body file may hold to be read: GitHub's own limit is 65536 characters. */
const maxBodyBytes = 1024 * 1024

/** Whether argv[index] holds no expansion; without `known`, whether it has no `$` or backtick. */
function wordKnown(command, index, value) {
  if (Array.isArray(command.known) && typeof command.known[index] === 'boolean')
    return command.known[index]
  return !/[$`]/.test(value)
}

function readRegularFile(file) {
  try {
    const info = statSync(file)
    if (!info.isFile() || info.size > maxBodyBytes) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

const stdinNames = new Set(['-', '/dev/stdin', '/dev/fd/0'])

function bodyFromFile(command, baseCwd, value, index) {
  const dir = path.resolve(String(baseCwd ?? '.'), command.cwd ?? '.')
  if (!wordKnown(command, index, value))
    return { known: false, text: null, source: 'file' }
  if (stdinNames.has(value)) {
    if (typeof command.stdinFile === 'string') {
      const text = readRegularFile(path.resolve(dir, command.stdinFile))
      return { known: text !== null, text, source: 'stdin' }
    }
    const known =
      typeof command.stdin === 'string' &&
      (typeof command.stdinKnown === 'boolean'
        ? command.stdinKnown
        : !/[$`]/.test(command.stdin))
    return { known, text: known ? command.stdin : null, source: 'stdin' }
  }
  const text = readRegularFile(path.resolve(dir, value))
  return { known: text !== null, text, source: 'file' }
}

/**
 * The body a command carries, from its options:
 * - inline, `-b/--body <text>`;
 * - a file, `-F/--body-file <path>`, relative to the command's cwd resolved
 *   against baseCwd; `-` (or /dev/stdin) is the command's stdin, a heredoc,
 *   a here-string or a `<` file;
 * - `-e/--editor` or `-w/--web`, typed elsewhere.
 *
 * `known` is false when the body cannot be read from here: a value with an
 * expansion or a substitution, a file that is missing, not a regular file or
 * too big, a stdin that is a pipe, or an editor or browser. A `$` that bash
 * leaves as it is (single quotes, a quoted heredoc) does not make it unknown.
 * With no body option, `{ known: true, text: null, source: 'none' }`.
 * The last occurrence wins, as in gh; `all` has every one, in order.
 *
 * @returns {{ known: boolean, text: string | null, source: 'inline' | 'file' | 'stdin' | 'editor' | 'web' | 'none', all: { known: boolean, text: string | null, source: string }[] }}
 */
export function readBody(
  command,
  baseCwd,
  {
    bodyFlags = ['-b', '--body'],
    fileFlags = ['-F', '--body-file'],
    unknownFlags = ['-e', '--editor', '-w', '--web'],
  } = {},
) {
  const argv = command.argv.map(String)
  const found = findOptions(argv, [...bodyFlags, ...fileFlags])
  const all = found.map(({ name, value, index }) =>
    fileFlags.includes(name)
      ? bodyFromFile(command, baseCwd, value, index)
      : {
          known: wordKnown(command, index, value),
          text: wordKnown(command, index, value) ? value : null,
          source: 'inline',
        },
  )
  const values = new Set(found.map((option) => option.index))
  const end = argv.indexOf('--')
  const opaque = argv.find(
    (arg, index) =>
      !values.has(index) &&
      (end < 0 || index < end) &&
      unknownFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
  )
  if (opaque !== undefined)
    return {
      known: false,
      text: null,
      source: /^(?:-w|--web)/.test(opaque) ? 'web' : 'editor',
      all,
    }
  if (all.length === 0) return { known: true, text: null, source: 'none', all }
  return { ...all.at(-1), all }
}

// ---------------------------------------------------------------------------
// What a command exports for the ones after it

/** Variables the rules read from the environment, carried across `export`. */
const watchedVariable = /^(?:GH_|GIT_|XDG_CONFIG_HOME$|HOME$)/

/**
 * The variables the rules read that `env -i` takes away from the command:
 * those that decide which git config gh reads (repo.mjs' gitConfigVariable,
 * but the numbered keys, which count only with GIT_CONFIG_COUNT) and those
 * that decide gh's host and repository.
 */
const clearedByEnv = [
  'HOME',
  'XDG_CONFIG_HOME',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GH_HOST',
  'GH_REPO',
  'GIT_DIR',
]

/**
 * Records in `exported` what the standalone assignments before a command
 * (`HOME=/x; gh …`, parseCommand's assignedBefore) may have left in its
 * environment. Such an assignment changes the environment only for a
 * variable the shell already exports (HOME always is), and which ones it
 * exports the hook cannot know: Claude Code's shell sources the person's
 * profile. So a watched variable assigned that way is kept as an expansion
 * (`${ATRIBUIDO}`), which every rule takes as unknown (Copilot review of
 * #26, seventh round: HOME moves the global git config gh reads). Called
 * before the command is judged, as recordExports is after.
 * @param {{ assignedBefore?: { name: string }[] }} command
 * @param {Record<string, string>} exported
 */
export function recordAssignments(command, exported) {
  for (const { name } of command.assignedBefore ?? [])
    if (watchedVariable.test(name)) exported[name] = '${ATRIBUIDO}'
}

/** Builtins that assign a variable in place without exporting it. */
const inPlaceDeclarers = new Set(['declare', 'typeset', 'local', 'readonly'])

/**
 * Records in `exported` what a command leaves in the environment of the
 * commands after it on the line: `export`, `declare -x`/`typeset -x` and
 * `unset` of a variable the rules read (GH_HOST, GH_REPO, GIT_DIR…). A value
 * the parser could not read, and a name exported with no value, are kept
 * as an expansion (`${EXPORTADO}`), which every rule takes as unknown; an
 * unset leaves it empty, as unset. guard-bash carries it across the line,
 * and plan-to-issue reads the host and the repository a publication goes
 * to through it (Copilot review of #26, fourth round).
 * @param {{ argv: string[], known?: boolean[] }} command
 * @param {Record<string, string>} exported
 */
export function recordExports(command, exported) {
  const argv = command.argv.map(String)
  const program = path.basename(argv[0] ?? '').replace(/\.exe$/i, '')
  const exporting =
    program === 'export' ||
    (['declare', 'typeset'].includes(program) &&
      argv.some((a) => /^-[a-z]*x/.test(a)))
  if (program === 'unset') {
    for (const name of argv.slice(1))
      if (watchedVariable.test(name)) exported[name] = ''
    return
  }
  if (!exporting && inPlaceDeclarers.has(program)) {
    // `declare HOME=/x` changes HOME in place, and so its exported value
    // when the shell exports it: unknown, as a standalone assignment is.
    for (const arg of argv.slice(1)) {
      const eq = arg.indexOf('=')
      if (eq > 0 && watchedVariable.test(arg.slice(0, eq)))
        exported[arg.slice(0, eq)] = '${ATRIBUIDO}'
    }
    return
  }
  if (!exporting) return
  for (const [index, arg] of argv.entries()) {
    if (index === 0 || arg.startsWith('-')) continue
    const eq = arg.indexOf('=')
    const name = eq < 0 ? arg : arg.slice(0, eq)
    if (!watchedVariable.test(name)) continue
    if (eq < 0) {
      if (!(name in exported)) exported[name] = '${EXPORTADO}'
    } else
      exported[name] =
        command.known?.[index] === false ? '${EXPORTADO}' : arg.slice(eq + 1)
  }
}
