// The shell guard (#5): a PreToolUse hook on Bash, Monitor and the terminal
// panel's mcp__terminal__run_in_terminal.
//
// It reads the command line the way bash would run it (lib/shell.mjs) and
// hands every `gh` and `git` in it, wrappers, substitutions and `bash -c`
// included, to the rules of lib/gh-rules.mjs and lib/git-rules.mjs, each in
// the directory that command runs in. The commands are judged in order, and
// what an earlier one leaves behind is carried to the later ones: a `cd`, an
// `export`, a `git checkout` that moves HEAD, a `git config` or `gh alias set`,
// a `git remote set-url` that changes the repository gh picks, a file written
// with `>` that a later command reads as a body.
//
// What the parser cannot see through is covered in two ways. A script handed
// to `sh`, `find -exec` or `watch` is read and judged like the line; a shell
// reading a pipe asks when the line mentions gh or git; a program whose name
// is an expansion is judged as each program the rules know, gh, git and a
// shell, and anything one of them would refuse asks, critical, since the
// program is not known. And a tripwire looks at the programs that run
// text of their own (`node -e`, an alias, a sourced file): next to a file
// only the loop writes, or next to a label, the Approve or a mutation when the
// program can start a process or reach the network, it asks a person to
// look. A command line that cannot be read whole, and mentions gh or git,
// asks as well. Plain writes to the files only the loop writes (the gate's
// cache, the plan marker, the owner's escape hatch) are refused, and to the
// harness they ask, in this project (any clone or worktree of it) or where
// the hook cannot tell the repository. A write is judged where it lands,
// through every link on disk and every link an earlier command of the line
// made (`ln`, `link`, `cp -s` and `cp -l`), or that a substitution or a
// `bash -c` script listed after it may make first, and as the link itself;
// and so is what the line wrote into a file a later command reads. What such
// a program writes is not known, so after one, a file the line reads (a
// body, a script) is unknown unless the line itself wrote it afterwards.
//
// The run has one time budget (lib/budget.mjs), shared by every git and gh
// it starts: past it, the line asks, critical, before Claude Code would kill
// the hook and let the line run undecided.
//
// The libraries are imported inside the try, not at the top: a module that
// fails to load would end the process with exit 1, which Claude Code reads
// as a non-blocking error and lets the command through. When io.mjs itself
// cannot load, there is no JSON to print, so the hook exits 2, which blocks.
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * The words of an exact first-line heading (`^# Owner Approve$` gives
 * `Owner Approve`), so the tripwire looks for the contract's own text rather
 * than a copy of it.
 */
const headingWords = (pattern) =>
  pattern.source.replace(/^\^#+ /, '').replace(/\[ \\t\]\*\$$|\$$/, '')

// ---------------------------------------------------------------------------
// Evaluators

/**
 * Evaluators in the raw text, for a line the parser could not read whole:
 * programs that run text the parser cannot read as a command line, and the
 * ways to leave a command behind for later (an alias, a sourced file). Each
 * is looked for at a word boundary. A line that parses is read by
 * evaluatorsOf instead, so a body or a message that only mentions `alias`
 * or `source` is not taken for one.
 */
const edge = String.raw`(?:^|[\s;&|()\`'"=/])`
const operand = String.raw`(?:[^\n;&|]*?\s)?`
const rawEvaluators = [
  {
    name: 'node -e',
    pattern: new RegExp(
      String.raw`${edge}node(?:\.exe)?\s${operand}(?:-[A-Za-z]*[ep]|--eval|--print)(?=[\s='"]|$)`,
    ),
  },
  {
    name: 'python -c',
    pattern: new RegExp(
      String.raw`${edge}python(?:3(?:\.\d+)?)?\s${operand}-[A-Za-z]*c(?=[\s'"]|$)`,
    ),
  },
  {
    name: 'perl -e',
    pattern: new RegExp(
      String.raw`${edge}perl\s${operand}-[A-Za-z]*[eE](?=[\s'"]|$)`,
    ),
  },
  {
    name: 'ruby -e',
    pattern: new RegExp(
      String.raw`${edge}ruby\s${operand}-[A-Za-z]*e(?=[\s'"]|$)`,
    ),
  },
  {
    name: 'osascript -e',
    pattern: new RegExp(String.raw`${edge}osascript\s${operand}-e(?=[\s'"]|$)`),
  },
  { name: 'deno eval', pattern: new RegExp(String.raw`${edge}deno\s+eval\b`) },
  { name: 'eval', pattern: new RegExp(String.raw`${edge}eval\s`) },
  {
    name: 'git config alias.',
    pattern: new RegExp(String.raw`${edge}git\s[^\n;&|]*\balias\.`),
  },
  {
    name: 'gh alias set',
    pattern: new RegExp(String.raw`${edge}gh\s+alias\s+(?:set|import)\b`),
  },
  { name: 'alias', pattern: new RegExp(String.raw`${edge}alias\s`) },
  { name: 'source', pattern: new RegExp(String.raw`${edge}source\s`) },
  {
    name: '. (source)',
    pattern: new RegExp(String.raw`(?:^|[;&|(]|\n)\s*\.\s+[^\s;&|]`),
  },
]

// ---------------------------------------------------------------------------
// What an interpreter's program can do
//
// A program that can neither start a process nor reach the network cannot
// write a label, a comment or a merge, whatever names it quotes: a script
// that edits a document about needs-triage is no indirection. So a label,
// the Approve or a mutation trips the tripwire only next to a program that
// can, read by what each language would have to spell for it (the modules
// and calls that start processes, open sockets or speak HTTP, and those that
// load code chosen at run time). A mention of `gh ` or of GitHub's API counts
// in any language. It is a reading of the text, and it errs toward
// restricting: a word inside a string counts like code.

/**
 * In any language: a gh command line (`gh ` and a word after it), or
 * GitHub's API. Only a program that can start a process could run the first,
 * but a spelled-out gh command is what the rules would judge, so it counts.
 */
const reachesGithub = /(?:^|[^\w.-])gh\s|api\.github\.com|\/graphql\b/

/** Python modules that start processes, open sockets, speak HTTP or load code. */
const pythonModules = new Set([
  'aiohttp',
  'asyncio',
  'cffi',
  'code',
  'commands',
  'concurrent',
  'ctypes',
  'ftplib',
  'http',
  'httplib',
  'httplib2',
  'httpx',
  'importlib',
  'multiprocessing',
  'pdb',
  'pexpect',
  'plumbum',
  'popen2',
  'pty',
  'requests',
  'runpy',
  'selectors',
  'sh',
  'smtplib',
  'socket',
  'ssl',
  'subprocess',
  'telnetlib',
  'urllib',
  'urllib2',
  'urllib3',
  'webbrowser',
  'xmlrpc',
])

/** os's calls that start a process. */
const osProcessCall =
  /\b(?:system|popen\w*|exec[lv]p?e?|spawn[lv]p?e?|fork\w*|posix_spawnp?|startfile)\b/

function pythonCapable(text) {
  for (const statement of text.split(/[\n;]/)) {
    const line = statement.trim()
    const from = /^from\s+([\w.]+)\s+import\b/.exec(line)
    const names = from
      ? [from[1]]
      : (/^import\s+(.+)$/.exec(line)?.[1].split(',') ?? [])
    for (const name of names) {
      const root = name.trim().split(/[\s.]/)[0]
      if (pythonModules.has(root)) return true
      if (root === 'os' && from && osProcessCall.test(text)) return true
    }
  }
  return (
    /\bos\s*\.\s*(?:system|popen\w*|exec[lv]\w*|spawn\w*|fork\w*|posix_spawn\w*|startfile)\b/.test(
      text,
    ) ||
    /\.\s*(?:system|popen)\s*\(/.test(text) ||
    /\b(?:__import__|__builtins__|importlib|runpy)\b|\bgetattr\s*\(\s*os\b/.test(
      text,
    ) ||
    // exec(), eval() and compile() themselves, not re.compile().
    /(?<![.\w])(?:exec|eval|compile)\s*\(/.test(text)
  )
}

const nodeCapability = new RegExp(
  [
    // Built-in modules that start processes, open sockets or run code.
    String.raw`['"\`](?:node:)?(?:child_process|cluster|dgram|dns|http|http2|https|inspector|module|net|repl|tls|vm|worker_threads)['"\`]`,
    String.raw`\b(?:fetch|eval|Function|import)\s*\(`,
    String.raw`\bnew\s+Function\b`,
    // Code the program loads from a path, or from a name it computes.
    String.raw`\brequire\s*\(\s*(?:['"\`][./~]|[^'"\`\s)])`,
    String.raw`\b(?:from|import)\s+['"\`][./~]`,
    String.raw`\b(?:WebSocket|XMLHttpRequest|EventSource|Worker)\b`,
    String.raw`\bprocess\s*\.\s*(?:binding|_linkedBinding|dlopen|mainModule)\b`,
    String.raw`\bmodule\s*\.\s*constructor\b`,
    String.raw`\b(?:Deno|Bun)\s*\.`,
    String.raw`\bglobalThis\s*\[`,
  ].join('|'),
)

const perlCapability =
  /\b(?:system|exec|qx|fork|pipe|socket|syscall|readpipe|eval)\b|`|\bopen\b[^;]*\||\bdo\s*['"$]|\b(?:use|require)\s+(?:IO::Socket|IO::Pipe|Socket|LWP|HTTP::|Net::|IPC::|Proc::)/

const rubyCapability =
  /\b(?:system|exec|spawn|fork|popen|Open3|PTY|Process|Kernel|Socket|TCPSocket|UDPSocket|UNIXSocket|eval|instance_eval|class_eval|module_eval|send|__send__|public_send|require|require_relative|load)\b|`|%x|\bNet::|\bURI\s*\.\s*open\b|open-uri|\bopen\s*\(\s*['"]\|/

/**
 * Interpreters, and how each takes a program: `flags` are the letters (and
 * `long` the options) that take it inline, attached to the letter too unless
 * `detached`; `valued` letters and `longValued` options take the next word;
 * `attached` letters take the rest of theirs; a `stop` letter makes the rest
 * arguments (python -m). With none of these, the first operand is a script
 * file, and no operand (or `-`) is a program read from stdin. `single` when
 * the first inline program ends the options. `preload` are the options that
 * load code before the program; `capable` reads a program's text.
 */
const interpreters = [
  {
    names: /^(?:node|nodejs)$/,
    label: 'node -e',
    flags: 'ep',
    detached: true,
    single: true,
    long: ['--eval', '--print'],
    valued: 'rC',
    longValued: [
      '--require',
      '--import',
      '--loader',
      '--experimental-loader',
      '--conditions',
      '--input-type',
      '--env-file',
      '--title',
    ],
    preload: /^(?:-r|--require|--import|--loader|--experimental-loader)(?:=|$)/,
    capable: (text) => nodeCapability.test(text),
  },
  {
    names: /^(?:python|pypy)(?:\d+(?:\.\d+)?)?$/,
    label: 'python -c',
    flags: 'c',
    single: true,
    stop: 'm',
    valued: 'WX',
    capable: pythonCapable,
  },
  {
    names: /^perl$/,
    label: 'perl -e',
    flags: 'eE',
    attached: 'IMmxiCdD0l',
    preload: /^-[A-Za-z]*[Mm]/,
    capable: (text) => perlCapability.test(text),
  },
  {
    names: /^ruby$/,
    label: 'ruby -e',
    flags: 'e',
    valued: 'rIC',
    preload: /^-[A-Za-z]*r/,
    capable: (text) => rubyCapability.test(text),
  },
  {
    // AppleScript runs shell scripts (`do shell script`) by design.
    names: /^osascript$/,
    label: 'osascript -e',
    flags: 'e',
    valued: 'ls',
    capable: () => true,
  },
]

/**
 * The programs an interpreter takes inline (`-e`, `-c`, `--eval`), and
 * whether all of them hold no expansion.
 */
function inlinePrograms(command, spec) {
  const argv = command.argv.map(String)
  const known = (k) => command.known?.[k] !== false
  const texts = []
  let allKnown = true
  const take = (text, k) => {
    texts.push(text)
    if (!known(k)) allKnown = false
  }
  for (let k = 1; k < argv.length; k += 1) {
    const arg = argv[k]
    if (arg === '--' || arg === '-' || !arg.startsWith('-')) break
    let taken = false
    if (arg.startsWith('--')) {
      const name = arg.split('=')[0]
      if ((spec.long ?? []).includes(name)) {
        if (arg.includes('=')) take(arg.slice(name.length + 1), k)
        else if (k + 1 < argv.length) {
          take(argv[k + 1], k + 1)
          k += 1
        }
        taken = true
      } else if ((spec.longValued ?? []).includes(name) && !arg.includes('='))
        k += 1
    } else
      for (let p = 1; p < arg.length; p += 1) {
        const letter = arg[p]
        if (spec.flags.includes(letter)) {
          const attached = arg.slice(p + 1)
          if (attached !== '' && !spec.detached) take(attached, k)
          else if (k + 1 < argv.length) {
            take(argv[k + 1], k + 1)
            k += 1
          }
          taken = true
          break
        }
        if ((spec.stop ?? '').includes(letter))
          return { texts, known: allKnown }
        if ((spec.attached ?? '').includes(letter)) break
        if ((spec.valued ?? '').includes(letter)) {
          if (p === arg.length - 1) k += 1
          break
        }
      }
    if (taken && spec.single) break
  }
  return { texts, known: allKnown }
}

/** Options with which an interpreter runs no program at all. */
const noProgram = new Set(['--version', '-v', '-V', '--help', '-h'])

/** Where an interpreter takes its program from: 'inline', 'stdin', 'file' or 'none'. */
function programSource(argv, spec) {
  for (let k = 1; k < argv.length; k += 1) {
    const arg = argv[k]
    if (noProgram.has(arg)) return 'none'
    if (arg === '-') return 'stdin'
    if (arg === '--') return argv[k + 1] === undefined ? 'stdin' : 'file'
    if (arg.startsWith('--')) {
      const name = arg.split('=')[0]
      if ((spec.long ?? []).includes(name)) return 'inline'
      if ((spec.longValued ?? []).includes(name) && !arg.includes('=')) k += 1
      continue
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (let p = 1; p < arg.length; p += 1) {
        const letter = arg[p]
        if (spec.flags.includes(letter)) return 'inline'
        if ((spec.stop ?? '').includes(letter)) return 'file'
        if ((spec.attached ?? '').includes(letter)) break
        if ((spec.valued ?? '').includes(letter)) {
          if (p === arg.length - 1) k += 1
          break
        }
      }
      continue
    }
    return 'file'
  }
  return 'stdin'
}

const shells = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

/** The program a command runs, without its directory (`/usr/bin/gh` is gh). */
const programOf = (command) =>
  path.basename(String(command.argv[0] ?? '')).replace(/\.exe$/i, '')

/**
 * The evaluators a parsed command is: the programs that run text the rules
 * cannot read as a command line (the spec's list, and an interpreter reading
 * its program from stdin), and the ways to leave a command behind. Each as
 * { name, capable }: `capable` when it may start a process or reach the
 * network. An interpreter is read by its program (and by the code it
 * preloads); a program it cannot read counts as capable, and so does every
 * shell-level evaluator, whose text is a command line.
 */
function evaluatorsOf(command, ctx, libs, state) {
  const program = programOf(command)
  const argv = command.argv.map(String)
  const found = []
  const shellLevel = (name) => found.push({ name, capable: true })
  for (const spec of interpreters)
    if (spec.names.test(program)) {
      const source = programSource(argv, spec)
      if (source !== 'inline' && source !== 'stdin') continue
      const preloads =
        spec.preload !== undefined &&
        argv.slice(1).some((arg) => spec.preload.test(arg))
      let texts = []
      let known = false
      if (source === 'inline')
        ({ texts, known } = inlinePrograms(command, spec))
      else {
        const read = stdinText(command, ctx.cwd, state)
        known = read.known
        texts = read.known ? [read.text] : []
      }
      found.push({
        name:
          source === 'inline'
            ? spec.label
            : `${program} lendo o programa do stdin`,
        capable:
          !known ||
          preloads ||
          texts.some((text) => reachesGithub.test(text) || spec.capable(text)),
      })
    }
  if (
    program === 'deno' &&
    argv.slice(1).find((w) => !w.startsWith('-')) === 'eval'
  )
    shellLevel('deno eval')
  if (program === 'eval') shellLevel('eval')
  if (program === 'alias' && argv.length > 1) shellLevel('alias')
  if (program === 'source' || program === '.') shellLevel('source')
  if (program === 'git' && libs.git.definesAlias(command, ctx))
    shellLevel('git config alias.')
  if (program === 'gh') {
    const words = argv.slice(1).filter((word) => !word.startsWith('-'))
    if (words[0] === 'alias' && ['set', 'import'].includes(words[1]))
      shellLevel('gh alias set')
  }
  return found
}

/**
 * Whether a command runs a program the hook does not read and that may write
 * any file: a program whose name is unknown, an interpreter's inline or stdin
 * program, eval, source.
 */
function writesUnseen(command) {
  if (command.known?.[0] === false) return true
  const program = programOf(command)
  const argv = command.argv.map(String)
  if (['eval', 'source', '.'].includes(program)) return true
  if (
    program === 'deno' &&
    argv.slice(1).find((w) => !w.startsWith('-')) === 'eval'
  )
    return true
  return interpreters.some(
    (spec) =>
      spec.names.test(program) &&
      ['inline', 'stdin'].includes(programSource(argv, spec)),
  )
}

/**
 * The names the loop guards, in the contract's own text. `files` are those
 * only the loop writes (the gate's cache, the plan marker, the owner's escape
 * hatch): any program can write a file. `actions` are the state labels, the
 * Approve and its withdrawal, and the mutations that write labels, resolve
 * threads or merge: only a program that reaches GitHub can act on them.
 */
function sensitiveNames({ loop, gh }) {
  return {
    files: [loop.gateCacheFile, loop.planPendingPrefix, settingsLocal],
    actions: [
      ...loop.stateLabels,
      headingWords(loop.approveHeading),
      headingWords(loop.withdrawHeading),
      ...gh.tripwireMutations,
    ],
  }
}

/**
 * The tripwire: an evaluator and, anywhere in the same text, a file only the
 * loop writes; or an evaluator that can start a process or reach the network
 * and, anywhere in the same text, a label, the Approve or a mutation. The
 * whole line is searched, not only the program: a name may reach it as an
 * argument, a variable or a file the line writes. Compared without case, so
 * a lower-cased label or heading still trips it. It asks and is critical: in
 * the modes where nobody is asked, an indirection the rules cannot read is
 * refused.
 */
function tripwire(text, evaluators, libs) {
  const { io } = libs
  if (evaluators.length === 0) return io.pass()
  const folded = text.toLowerCase()
  const names = sensitiveNames(libs)
  const named = (list) =>
    list.find((candidate) => folded.includes(candidate.toLowerCase()))
  const file = named(names.files)
  const capable = evaluators.find((evaluator) => evaluator.capable)
  const action = capable === undefined ? undefined : named(names.actions)
  const [evaluator, name] =
    file !== undefined ? [evaluators[0], file] : [capable, action]
  if (name === undefined) return io.pass()
  return io.ask(
    `indireção que cita o loop: confira (${evaluator.name} junto de ${name})`,
    { critical: true },
  )
}

/**
 * What the hook cannot read (a script, a pipe, a line it cannot parse whole)
 * where a gh or a git it would refuse may run: it asks, critical, so the
 * modes where nobody is asked refuse it (Copilot review of #26, third
 * round). Which such program asks at all is still told by mentionsGhOrGit:
 * a program the line runs from elsewhere is a documented limit.
 */
const unread = (io, reason) => io.ask(reason, { critical: true })

/** Whether the line names gh or git as a word: then an opaque program asks. */
const mentionsGhOrGit = (text) =>
  /(?:^|[^\w.-])(?:gh|git)(?:\s|$|['"])/.test(text)

// ---------------------------------------------------------------------------
// One simple command's text, for what shell.mjs leaves out

/**
 * The words and redirections of one simple command's text, split the way the
 * shell splits them, nothing expanded: shell.mjs's argv holds neither the
 * redirections nor the wrappers it took off (`xargs`), and those are what
 * this is for. A word holding an expansion or a substitution is not known.
 */
function scanText(text) {
  const words = []
  const redirs = []
  const n = text.length
  let k = 0
  const closing = (from) => {
    let depth = 0
    let j = from
    while (j < n) {
      const c = text[j]
      if (c === '\\') j += 2
      else if (c === "'") {
        const end = text.indexOf("'", j + 1)
        j = end < 0 ? n : end + 1
      } else if (c === '"') {
        j += 1
        while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
        j += 1
      } else {
        if (c === '(') depth += 1
        if (c === ')' && --depth === 0) return j + 1
        j += 1
      }
    }
    return n
  }
  const readWord = () => {
    const start = k
    let value = ''
    let known = true
    while (k < n && !' \t\n;&|()<>'.includes(text[k])) {
      const c = text[k]
      if (c === '\\') {
        value += text[k + 1] ?? ''
        k += 2
      } else if (c === "'") {
        const end = text.indexOf("'", k + 1)
        value += text.slice(k + 1, end < 0 ? n : end)
        k = end < 0 ? n : end + 1
      } else if (c === '"') {
        k += 1
        while (k < n && text[k] !== '"') {
          if (text[k] === '\\' && k + 1 < n) {
            value += text[k + 1]
            k += 2
          } else if (text[k] === '$' && text[k + 1] === '(') {
            known = false
            const end = closing(k + 1)
            value += text.slice(k, end)
            k = end
          } else {
            if (text[k] === '$' || text[k] === '`') known = false
            value += text[k]
            k += 1
          }
        }
        k += 1
      } else if (c === '$' && text[k + 1] === '(') {
        known = false
        const end = closing(k + 1)
        value += text.slice(k, end)
        k = end
      } else if (c === '`') {
        known = false
        const end = text.indexOf('`', k + 1)
        value += text.slice(k, end < 0 ? n : end + 1)
        k = end < 0 ? n : end + 1
      } else {
        if (c === '$') known = false
        value += c
        k += 1
      }
    }
    return { value, known, raw: text.slice(start, k) }
  }
  while (k < n) {
    const c = text[k]
    if (' \t\n'.includes(c)) {
      k += 1
      continue
    }
    const op = /^(\d*|&)(>>|>\||>&|>|<<<|<<-|<<|<>|<&|<)/.exec(text.slice(k))
    if (op !== null) {
      k += op[0].length
      // `>(cmd)` and `<(cmd)` are process substitutions, not files.
      if (text[k] === '(') {
        k = closing(k)
        continue
      }
      while (text[k] === ' ' || text[k] === '\t') k += 1
      const target = readWord()
      if (op[2].startsWith('<<')) continue
      if (
        (op[2] === '>&' || op[2] === '<&') &&
        /^(?:\d+|-)$/.test(target.value)
      )
        continue
      redirs.push({
        op: op[1] === '&' || op[2] === '>&' ? '&>' : op[2],
        append: op[2] === '>>',
        fd: /^\d+$/.test(op[1]) ? op[1] : null,
        target,
      })
      continue
    }
    if (';&|()'.includes(c)) {
      k += 1
      continue
    }
    const word = readWord()
    if (word.raw === '') k += 1
    else words.push(word)
  }
  return { words, redirs }
}

// ---------------------------------------------------------------------------
// What a command prints, for a file it writes with `>`

/** printf's and echo's backslash escapes; `\c` ends the output. */
function unescape(text) {
  const simple = {
    n: '\n',
    t: '\t',
    r: '\r',
    a: '\x07',
    b: '\b',
    f: '\f',
    v: '\v',
    e: '\x1b',
    '\\': '\\',
    '"': '"',
    "'": "'",
  }
  let out = ''
  for (let k = 0; k < text.length; k += 1) {
    if (text[k] !== '\\' || k + 1 >= text.length) {
      out += text[k]
      continue
    }
    const next = text[k + 1]
    if (next === 'c') return { text: out, stop: true }
    if (next in simple) {
      out += simple[next]
      k += 1
      continue
    }
    const octal = /^0?[0-7]{1,3}/.exec(text.slice(k + 1))
    if (octal !== null) {
      out += String.fromCharCode(Number.parseInt(octal[0], 8))
      k += octal[0].length
      continue
    }
    const hex = /^x[0-9a-fA-F]{1,2}/.exec(text.slice(k + 1))
    if (hex !== null) {
      out += String.fromCharCode(Number.parseInt(hex[0].slice(1), 16))
      k += hex[0].length
      continue
    }
    out += '\\'
  }
  return { text: out, stop: false }
}

/** printf's output for a format and arguments, or null for a conversion it does not know. */
function printfText(args) {
  const [format, ...rest] = args
  if (format === undefined) return null
  const { text: template } = unescape(format)
  let out = ''
  let next = 0
  let known = true
  do {
    let used = false
    out += template.replace(
      /%(?:(%)|[-+ #0]*\d*(?:\.\d*)?([a-zA-Z]))/g,
      (_, percent, letter) => {
        if (percent) return '%'
        used = true
        const arg = rest[next] ?? ''
        next += 1
        if (letter === 's') return arg
        if (letter === 'b') return unescape(arg).text
        if (letter === 'd' || letter === 'i')
          return String(Number.parseInt(arg, 10) || 0)
        if (letter === 'c') return arg.slice(0, 1)
        known = false
        return ''
      },
    )
    if (!used) break
  } while (next < rest.length)
  return known ? out : null
}

const unknownText = { known: false, text: null }

/**
 * The placing functions of lib/repo.mjs (placeOf, Unplaceable), set when the
 * libraries load: the file readers below need them, and are called from too
 * many places to take them as an argument.
 */
let places = null

// ---------------------------------------------------------------------------
// Links the line makes (Copilot review of #26, eighth round)

/** A link the line made whose destination the hook could not read. */
class UnknownLink extends Error {
  constructor(at, text) {
    super(
      `não consegui ler aonde leva o link ${at} que a linha criou (${text})`,
    )
    this.at = at
    this.text = text
  }
}

/**
 * Links of the line, as placeOf's `lineLink` reads them: by the entry's real
 * path, compared without case, as macOS's default file system compares names
 * (a link matched wrongly only adds a place to judge, since the disk's is
 * judged too). A link whose destination is not known throws.
 */
const linkReader = (links) => (next) => {
  const made = links.get(next.toLowerCase())
  if (made === undefined) return null
  if (made.to === null) throw new UnknownLink(next, made.text)
  return made.to
}

/** The links the commands before this one made (state.links). */
const lineLinkOf = (state) => linkReader(state.links)

/**
 * The ways the links that commands listed after this one make may leave a
 * path (state.laterLinks): a substitution or a `bash -c` script is listed
 * after the line's own commands, but runs before the command that holds it.
 * Whether such a link came before or after one the earlier commands made at
 * the same entry is not known, so both orders are read.
 */
function laterReadings(state) {
  if (state.laterLinks.size === 0) return []
  const over = linkReader(new Map([...state.links, ...state.laterLinks]))
  if (state.links.size === 0) return [over]
  return [over, linkReader(new Map([...state.laterLinks, ...state.links]))]
}

/**
 * Where a file's content is kept for the commands after the one that wrote
 * it: the place a read or a write of it lands, as a real path, every link
 * followed, the ones the line made included. `shadowed` is where the disk
 * alone leads, when a link of the line leads elsewhere; `maybe`, where a
 * link a command listed later makes may lead instead (laterReadings). null
 * when the place cannot be told: a link whose destination the line does not
 * say, a loop, a name it cannot read.
 */
function contentPlace(file, state) {
  try {
    const onDisk = places.placeOf(file)
    const onLine =
      state.links.size === 0
        ? onDisk
        : places.placeOf(file, { lineLink: lineLinkOf(state) })
    const maybe = new Set()
    for (const lineLink of laterReadings(state)) {
      const other = places.placeOf(file, { lineLink })
      if (other !== onLine) maybe.add(other)
    }
    return {
      key: onLine,
      shadowed: onLine === onDisk ? null : onDisk,
      maybe: [...maybe],
    }
  } catch (error) {
    if (error instanceof UnknownLink || error instanceof places.Unplaceable)
      return null
    throw error
  }
}

/** Whether what a read finds at a place (contentPlace) can be told. */
const certain = (place) => place !== null && place.maybe.length === 0

/**
 * What the line wrote at a place, or undefined. When the line also wrote a
 * name that differs from it only in case, unknown: on macOS it is the same
 * file, and the last of the writes holds.
 */
function writtenAt(key, state) {
  const folded = key.toLowerCase()
  for (const other of state.written.keys())
    if (other !== key && other.toLowerCase() === folded) return unknownText
  return state.written.get(key)
}

/**
 * A file's text as the command finds it: what the line wrote where it lands,
 * else the disk there, unless a program the hook does not read ran before
 * (state.untracked).
 */
function fileText(file, state) {
  const place = contentPlace(file, state)
  if (!certain(place)) return unknownText
  const written = writtenAt(place.key, state)
  if (written !== undefined) return written
  if (state.untracked) return unknownText
  try {
    const info = statSync(place.key)
    if (!info.isFile() || info.size > 1024 * 1024) return unknownText
    return { known: true, text: readFileSync(place.key, 'utf8') }
  } catch {
    return unknownText
  }
}

/** The stdin a command reads when it is a heredoc, a here-string or a `<` file. */
function stdinText(command, cwd, state) {
  if (typeof command.stdinFile === 'string')
    return fileText(path.resolve(cwd, command.stdinFile), state)
  if (typeof command.stdin === 'string' && command.stdinKnown !== false)
    return { known: true, text: command.stdin }
  return unknownText
}

/**
 * What a command prints on stdout, when it can be told from the line: `echo`
 * (with its escapes, as zsh's does), `printf`, `cat` of files or of its
 * stdin, `tee` of its stdin. Anything else is unknown.
 */
function outputOf(command, cwd, state) {
  const argv = command.argv.map(String)
  if (argv.some((_, index) => command.known?.[index] === false))
    return unknownText
  const program = programOf(command)
  if (program === 'echo') {
    let k = 1
    let newline = true
    let escapes = true
    while (/^-[neE]+$/.test(argv[k] ?? '')) {
      if (argv[k].includes('n')) newline = false
      if (argv[k].includes('E')) escapes = false
      k += 1
    }
    const joined = argv.slice(k).join(' ')
    const { text, stop } = escapes ? unescape(joined) : { text: joined }
    return { known: true, text: newline && !stop ? `${text}\n` : text }
  }
  if (program === 'printf') {
    if (argv[1] === '-v') return unknownText
    const text = printfText(argv[1] === '--' ? argv.slice(2) : argv.slice(1))
    return text === null ? unknownText : { known: true, text }
  }
  if (program === 'cat') {
    const files = argv.slice(1)
    if (files.some((file) => file.startsWith('-') && file !== '-'))
      return unknownText
    if (files.length === 0) return stdinText(command, cwd, state)
    let text = ''
    for (const file of files) {
      const read =
        file === '-'
          ? stdinText(command, cwd, state)
          : fileText(path.resolve(cwd, file), state)
      if (!read.known) return unknownText
      text += read.text
    }
    return { known: true, text }
  }
  if (program === 'tee') return stdinText(command, cwd, state)
  return unknownText
}

// ---------------------------------------------------------------------------
// The files a command writes

/** Operands of a command: its words after argv[0] that are not options, `--` ending them. */
function operandsOf(command, from = 1, valued = []) {
  const argv = command.argv.map(String)
  const out = []
  let options = true
  for (let k = from; k < argv.length; k += 1) {
    const arg = argv[k]
    if (options && arg === '--') {
      options = false
      continue
    }
    if (options && arg.startsWith('-') && arg !== '-') {
      if (valued.includes(arg)) k += 1
      continue
    }
    out.push({ value: arg, known: command.known?.[k] !== false })
  }
  return out
}

/**
 * The redirections of a command, as scanText gives them: from shell.mjs,
 * whose targets are filled in like the words (`> "$SP/b.md"` after
 * `SP=/x`), or read again from the text when the command has none listed.
 */
function redirsOf(command) {
  if (!Array.isArray(command.redirs)) return scanText(command.text ?? '').redirs
  const out = []
  for (const { op, fd, target } of command.redirs) {
    if (target == null || op.startsWith('<<')) continue
    // `2>&1`, `>&-`: a descriptor, not a file.
    if ((op === '>&' || op === '<&') && /^(?:\d+|-)$/.test(target.value))
      continue
    out.push({
      op: op === '&>' || op === '&>>' || op === '>&' ? '&>' : op,
      append: op === '>>' || op === '&>>',
      fd,
      target,
    })
  }
  return out
}

/**
 * How the programs that copy, move or link take their options: `short`
 * letters and `long` options that take a value (attached, or as the next
 * word; a long one also after `=`); of those, `target` name the
 * destination directory and `writes` name another place the program writes.
 * Where two flavours disagree (GNU's `install -T` is a flag, BSD's takes a
 * value), the letter is read as a flag: the destination stays the last
 * operand, which is what the check needs.
 */
const copyPrograms = {
  cp: {
    short: 'tS',
    long: ['--target-directory', '--suffix'],
    target: ['-t', '--target-directory'],
  },
  mv: {
    short: 'tS',
    long: ['--target-directory', '--suffix'],
    target: ['-t', '--target-directory'],
  },
  ln: {
    short: 'tS',
    long: ['--target-directory', '--suffix'],
    target: ['-t', '--target-directory'],
  },
  install: {
    short: 'tSmogBfN',
    long: ['--target-directory', '--suffix', '--mode', '--owner', '--group'],
    target: ['-t', '--target-directory'],
  },
  // rsync's -t keeps modification times, and -o, -g, -m and -S are flags.
  rsync: {
    short: 'eBfTM@',
    long: [
      '--address',
      '--backup-dir',
      '--block-size',
      '--bwlimit',
      '--checksum-choice',
      '--checksum-seed',
      '--chmod',
      '--chown',
      '--compare-dest',
      '--compress-choice',
      '--compress-level',
      '--contimeout',
      '--copy-as',
      '--copy-dest',
      '--debug',
      '--early-input',
      '--exclude',
      '--exclude-from',
      '--files-from',
      '--filter',
      '--groupmap',
      '--iconv',
      '--include',
      '--include-from',
      '--info',
      '--link-dest',
      '--log-file',
      '--log-file-format',
      '--max-alloc',
      '--max-delete',
      '--max-size',
      '--min-size',
      '--modify-window',
      '--only-write-batch',
      '--out-format',
      '--outbuf',
      '--partial-dir',
      '--password-file',
      '--port',
      '--protocol',
      '--read-batch',
      '--remote-option',
      '--rsh',
      '--rsync-path',
      '--skip-compress',
      '--sockopts',
      '--stop-after',
      '--stop-at',
      '--suffix',
      '--temp-dir',
      '--timeout',
      '--usermap',
      '--write-batch',
    ],
    target: [],
    // Files rsync hard-links from this directory in place of copying them.
    links: ['--link-dest'],
    writes: [
      '-T',
      '--backup-dir',
      '--log-file',
      '--only-write-batch',
      '--partial-dir',
      '--temp-dir',
      '--write-batch',
    ],
  },
  ditto: { short: '', long: ['--arch'], target: [] },
}

/**
 * A copying program's operands, and the values of its options that name
 * where it writes (`targets`, then `alsoWritten`) or what it hard-links
 * from (`linkSources`), each as { value, known }; and `flags`, the options
 * it took that hold no value (`-s`, `--force`). Options may come after the
 * operands, as GNU's tools take them; `--` ends them.
 */
function copyOperands(command, spec) {
  const argv = command.argv.map(String)
  const known = (k) => command.known?.[k] !== false
  const operands = []
  const targets = []
  const alsoWritten = []
  const linkSources = []
  const flags = new Set()
  const found = (name, value) => {
    if (spec.target.includes(name)) targets.push(value)
    if (spec.writes?.includes(name)) alsoWritten.push(value)
    if (spec.links?.includes(name)) linkSources.push(value)
  }
  let options = true
  for (let k = 1; k < argv.length; k += 1) {
    const arg = argv[k]
    if (options && arg === '--') {
      options = false
      continue
    }
    if (options && arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq < 0 ? arg : arg.slice(0, eq)
      if (!spec.long.includes(name)) {
        flags.add(name)
        continue
      }
      if (eq >= 0) found(name, { value: arg.slice(eq + 1), known: known(k) })
      else {
        found(name, { value: argv[k + 1] ?? '', known: known(k + 1) })
        k += 1
      }
      continue
    }
    if (options && arg.startsWith('-') && arg !== '-') {
      for (let p = 1; p < arg.length; p += 1) {
        if (!spec.short.includes(arg[p])) {
          flags.add(`-${arg[p]}`)
          continue
        }
        const attached = arg.slice(p + 1)
        if (attached !== '')
          found(`-${arg[p]}`, { value: attached, known: known(k) })
        else {
          found(`-${arg[p]}`, { value: argv[k + 1] ?? '', known: known(k + 1) })
          k += 1
        }
        break
      }
      continue
    }
    operands.push({ value: arg, known: known(k) })
  }
  return { operands, targets, alsoWritten, linkSources, flags }
}

/**
 * The files a command writes, moves away or removes, with what each will
 * hold when it can be told: its redirections, and the operands of the
 * programs that write files (`tee`, `cp`, `mv`, `rm`, `sed -i`…).
 * @returns {{ word: { value: string, known: boolean }, content: { known: boolean, text: string | null }, append?: boolean }[]}
 */
function writesOf(command, cwd, state) {
  const writes = []
  for (const redir of redirsOf(command)) {
    if (!['>', '>>', '>|', '&>', '<>'].includes(redir.op)) continue
    const stdout = redir.fd === null || redir.fd === '1'
    writes.push({
      word: redir.target,
      append: redir.append,
      content:
        stdout && redir.op !== '&>' && redir.op !== '<>'
          ? outputOf(command, cwd, state)
          : unknownText,
    })
  }
  const program = programOf(command)
  const argv = command.argv.map(String)
  const all = (operands, content = unknownText) =>
    writes.push(...operands.map((word) => ({ word, content })))
  if (program === 'tee') {
    const append = argv.some((arg) => /^-[a-z]*a|^--append$/.test(arg))
    for (const word of operandsOf(command))
      writes.push({ word, append, content: stdinText(command, cwd, state) })
  } else if (
    ['rm', 'unlink', 'shred', 'rmdir', 'truncate', 'touch'].includes(program)
  )
    all(operandsOf(command, 1, ['-s', '--size', '-r', '--reference']))
  else if (['chmod', 'chown', 'chgrp', 'chflags'].includes(program))
    all(
      operandsOf(command).slice(
        argv.some((a) => a.startsWith('--reference')) ? 0 : 1,
      ),
    )
  else if (['sed', 'gsed'].includes(program)) {
    if (argv.some((arg) => /^-[a-zA-Z]*i|^--in-place/.test(arg))) {
      const scripts = argv.some((arg) =>
        /^-[a-zA-Z]*[ef]$|^--(?:expression|file)/.test(arg),
      )
      all(
        operandsOf(command, 1, [
          '-e',
          '--expression',
          '-f',
          '--file',
          '-l',
        ]).slice(scripts ? 0 : 1),
      )
    }
  } else if (Object.hasOwn(copyPrograms, program)) {
    // Only what lands is written: the destination, and each source's name
    // inside it. A source is only read, except mv's, which goes away.
    const { operands, targets, alsoWritten } = copyOperands(
      command,
      copyPrograms[program],
    )
    let dir = targets.at(-1) ?? null
    let sources = operands
    if (dir === null && operands.length > 1) {
      dir = operands.at(-1)
      sources = operands.slice(0, -1)
    }
    all(alsoWritten)
    // mv takes its sources away, and so does rsync --remove-source-files.
    if (
      program === 'mv' ||
      (program === 'rsync' && argv.includes('--remove-source-files'))
    )
      all(sources)
    if (program === 'install' && argv.some((arg) => /^-[A-Za-z]*d/.test(arg)))
      // install -d creates every operand as a directory.
      all(operands)
    else if (program === 'ln' && dir === null && operands.length === 1)
      // ln with one operand links it into the current directory.
      all([
        {
          value: path.basename(operands[0].value),
          known: operands[0].known,
        },
      ])
    if (dir !== null) {
      // What the copy lands with: what the line wrote into its one source,
      // found where that lands (contentPlace), else unknown.
      const single = sources.length === 1 ? sources[0] : null
      const from =
        single?.known && program !== 'ln'
          ? contentPlace(path.resolve(cwd, single.value), state)
          : null
      const content = certain(from)
        ? (writtenAt(from.key, state) ?? unknownText)
        : unknownText
      writes.push({ word: dir, content })
      for (const source of sources)
        writes.push({
          word: {
            value: path.join(dir.value, path.basename(source.value)),
            known: dir.known && source.known,
          },
          content,
        })
    }
  } else if (program === 'find') {
    // -delete, or -exec of a program that removes or writes, may touch
    // anything under the start paths; their names are not on the line.
    if (findRemoves(argv)) all(findStartPaths(command))
  } else if (program === 'dd')
    for (const [index, arg] of argv.entries())
      if (arg.startsWith('of='))
        writes.push({
          word: {
            value: arg.slice(3),
            known: command.known?.[index] !== false,
          },
          content: unknownText,
        })
  return writes
}

/** The owner's escape hatch, by name: Claude Code's local settings file. */
const settingsLocal = 'settings.local.json'

/**
 * The directories whose settings.local.json Claude Code may read for every
 * session, this project's included, whatever repository holds them: the
 * user's own (~/.claude, or CLAUDE_CONFIG_DIR). Compared without case, as
 * macOS's default file system compares names.
 */
function userSettingsDirs() {
  const dirs = [path.join(homedir(), '.claude')]
  const configured = process.env.CLAUDE_CONFIG_DIR
  if (typeof configured === 'string' && configured !== '')
    dirs.push(path.resolve(configured))
  return dirs
}

const isUserSettings = (file, { realPathOf }) => {
  const dir = realPathOf(path.dirname(file)).toLowerCase()
  return userSettingsDirs().some(
    (candidate) =>
      realPathOf(candidate).toLowerCase() === dir ||
      path.resolve(candidate).toLowerCase() ===
        path.dirname(file).toLowerCase(),
  )
}

/**
 * The text of a path word the hook can resolve, or null. A word with no
 * expansion is itself; `$$`, the shell's process id, is digits. A leading
 * `$PWD` (`${PWD}`) is the directory the command runs in (`pwd`, when the
 * hook knows it and the line gives PWD no value of its own; setsPwd), which
 * the hook reads as it reads a relative path. Anything else holding `$` or
 * a backtick is not known.
 */
function readablePath(word, pwd) {
  if (word.known) return word.value
  let text = word.value.replaceAll('$$', '0')
  let prefix = ''
  const reference = /^\$(?:PWD|\{PWD\})(?=\/|$)/.exec(text)
  if (reference !== null && pwd !== null) {
    prefix = pwd
    text = text.slice(reference[0].length)
  }
  return /^[^$`]*$/.test(text) ? prefix + text : null
}

/**
 * Whether a text may give PWD a value of its own: any mention of it but a
 * plain `$PWD` or `${PWD}` (`PWD=`, `read PWD`, `${PWD:=x}`). An assignment
 * shell.mjs reads is filled in already; this is for the rest.
 */
const setsPwd = (text) =>
  /(?<![\w$])PWD\b/.test(
    String(text ?? '').replace(/\$(?:PWD|\{PWD\})(?!\w)/g, ''),
  )

/** The directory `$PWD` names for a command, or null when it is not known. */
const pwdOf = (cwd, cwdKnown, state) =>
  cwdKnown && state.pwdKnown ? cwd : null

/** The absolute path a word names for a command, or null when it is not known. */
function pathOf(word, cwd, cwdKnown, state) {
  const readable = readablePath(word, pwdOf(cwd, cwdKnown, state))
  if (readable === null || !(cwdKnown || path.isAbsolute(readable))) return null
  return path.resolve(cwd, readable)
}

/**
 * A write to a file the loop keeps: the owner's escape hatch and the files
 * only the gate and the hooks write are refused; the harness asks, as an
 * edit of it does in build-guard.
 *
 * The names are this project's files (Copilot review of #26): they are
 * refused where the write lands in this project, any clone or worktree of it,
 * and where the hook cannot tell (a path or a cwd that holds an expansion,
 * a git that fails), judged then by the names the path spells. Another
 * repository's, or a directory under none, are not the loop's. The user's
 * own settings.local.json stays refused wherever it lies: Claude Code may
 * read it for every session, and the current rule refused it.
 *
 * A write whose place cannot be read (an expansion, a relative path after
 * a `cd` it cannot read) may land on the harness: it asks, critical, so the
 * modes where nobody is asked refuse it (Copilot review of #26, third
 * round). `$$`, the shell's process id, is digits, and an absolute path does
 * not depend on the directory: neither leaves the place unknown.
 *
 * The path is judged as spelled and where it lands (Copilot review of #26,
 * eighth round): through every symlink, the last one and dangling ones
 * included, on disk and as the links an earlier command of the line made
 * leave it (and those a command listed later may make first), and as the
 * entry itself when it is a link, since which one a program opens (a
 * shell's `>` follows the link, `sed -i` and `rm` do not) is not ours to
 * know. The worst wins. A `write.hardLink` is a file a hard link gives a new
 * name to, judged as written, since writing that name writes it.
 */
function protectedWrite(write, cwd, cwdKnown, repoOf, libs, state) {
  const { io } = libs
  const spelled = write.word.value
  const hard = write.hardLink === true ? ' (por um link físico novo)' : ''
  const readable = readablePath(write.word, pwdOf(cwd, cwdKnown, state))
  const file =
    readable !== null && (cwdKnown || path.isAbsolute(readable))
      ? path.resolve(cwd, readable)
      : null
  if (file === null)
    return (
      byNameAlone(`${spelled}${hard}`, spelled, libs) ??
      unread(
        io,
        `não consegui ler onde o comando escreve (${spelled}${hard}): confira que não é um caminho do harness nem um arquivo do loop`,
      )
    )
  const decisions = [
    judgePlace(
      { file, spelled, shown: `${spelled}${hard}`, via: hard },
      repoOf,
      libs,
    ),
  ]
  // As written, `..` is taken from the directory a link reaches, as the
  // kernel takes it; resolved, as text. Both are placed.
  const written = path.isAbsolute(readable) ? readable : `${cwd}/${readable}`
  for (const place of placesOf([written, file], state, libs)) {
    if (place.target === file && !place.entry) continue
    if (place.target !== undefined)
      decisions.push(
        judgePlace(
          place.entry
            ? {
                file: place.target,
                spelled,
                shown: `${spelled}${hard} (o link em si, ${place.target})`,
                via: `${hard} (o link ${spelled} em si)`,
                entry: true,
              }
            : {
                file: place.target,
                spelled,
                shown: `${spelled}${hard} (que leva a ${place.target})`,
                via: `${hard} (por ${spelled})`,
              },
          repoOf,
          libs,
        ),
      )
    else if (place.link !== undefined)
      decisions.push(
        byNameAlone(
          `${spelled}${hard} (pelo link ${place.link.at}, que leva a ${place.link.text})`,
          place.link.text,
          libs,
        ) ??
          unread(
            io,
            `${place.link.message}, por onde o comando escreve em ${spelled}${hard}: confira que não é um caminho do harness nem um arquivo do loop`,
          ),
      )
    else
      decisions.push(
        unread(
          io,
          `${place.refusal}: confira que não é um caminho do harness nem um arquivo do loop`,
        ),
      )
  }
  return io.combine(decisions)
}

/**
 * Where a path lands, spelled each way given: every link followed, and the
 * entry itself where it is a link (its last name not followed), each as the
 * disk has it and as the links of the line leave it: those the commands
 * before made, and those a command listed later may make first
 * (laterReadings). Each as { target, entry } (a real path, and whether it is
 * the link itself), { link } (an UnknownLink on the way) or { refusal } (a
 * name it could not read, a loop).
 */
function placesOf(spellings, state, { repo: repoLib }) {
  const through = [
    null,
    ...(state.links.size > 0 ? [lineLinkOf(state)] : []),
    ...laterReadings(state),
  ]
  const found = new Map()
  for (const spelling of new Set(spellings))
    for (const lineLink of through) {
      let followed = null
      for (const followLast of [true, false])
        try {
          const target = repoLib.placeOf(spelling, { followLast, lineLink })
          if (followLast) followed = target
          else if (target === followed) continue
          found.set(`${followLast ? 'path' : 'entry'}:${target}`, {
            target,
            entry: !followLast,
          })
        } catch (error) {
          if (error instanceof UnknownLink)
            found.set(`link:${error.at}`, { link: error })
          else if (error instanceof repoLib.Unplaceable)
            found.set(`error:${error.message}`, { refusal: error.message })
          else throw error
        }
    }
  return [...found.values()]
}

/**
 * A write whose place cannot be read, judged by the names its text spells:
 * the owner's escape hatch and the loop's own files are refused, since the
 * repository cannot be told. null when it names neither.
 */
function byNameAlone(shown, text, { io, loop }) {
  if (text.includes(settingsLocal))
    return io.deny(
      `o comando escreve em ${shown}: .claude/settings.local.json é a saída de emergência do dono`,
    )
  if (
    text.includes(loop.gateCacheFile) ||
    text.includes(loop.planPendingPrefix)
  )
    return io.deny(
      `o comando mexe em ${shown}, que só o gate e os hooks escrevem: rode npm run gate, e publique o plano numa issue para o marcador sair`,
    )
  return null
}

/**
 * One place a write lands, judged: by its name, where it lies (placeOfWrite)
 * and whether it is the harness. `shown` names it in the reasons, `via`
 * says how the write reaches it, after a harness path. An `entry` is judged
 * as itself: a link whose last name is not followed, since the program
 * replaces or removes the link.
 */
function judgePlace(
  { file, spelled, shown, via, entry = false },
  repoOf,
  libs,
) {
  const { io, loop, repo: repoLib, budget } = libs
  const name = path.basename(file)
  const hatch = name === settingsLocal
  const loopFile =
    name === loop.gateCacheFile || name.startsWith(loop.planPendingPrefix)
  let ours = true
  if (hatch || loopFile)
    try {
      const owner = repoOf(
        repoLib.existingDirOf(entry ? path.dirname(file) : file),
      )
      ours = owner != null && repoLib.isProject(owner)
    } catch (error) {
      // git could not say whose file it is: judged by its name.
      if (error instanceof budget.BudgetExhausted) throw error
      ours = true
    }
  if (hatch && (ours || isUserSettings(file, repoLib)))
    return io.deny(
      `o comando escreve em ${shown}: .claude/settings.local.json é a saída de emergência do dono`,
    )
  if (loopFile && ours)
    return io.deny(
      `o comando mexe em ${shown}, que só o gate e os hooks escrevem: rode npm run gate, e publique o plano numa issue para o marcador sair`,
    )
  const byPlace = placeOfWrite(shown, spelled, file, repoOf, libs, entry)
  if (byPlace !== null) return byPlace
  if (!/[/\\]\.(?:claude|github)(?:[/\\]|$)|[/\\]scripts[/\\]/i.test(file))
    return io.pass()
  const repo = repoOf(path.dirname(file))
  if (repo == null || !repoLib.isProject(repo)) return io.pass()
  const relative = relativeIn(repo, file, entry, repoLib)
  if (relative === null || !repoLib.isHarnessPath(relative)) return io.pass()
  return io.ask(
    `o comando escreve em ${relative}${via}, caminho do harness: confira`,
    { critical: true },
  )
}

/**
 * A path relative to the repository's top, as repoRelative gives it; for an
 * entry, its directory's with its own name added, so a last name that is a
 * link is not followed.
 */
function relativeIn(repo, file, entry, repoLib) {
  if (!entry) return repoLib.repoRelative(repo, file)
  const dir = repoLib.repoRelative(repo, path.dirname(file))
  if (dir === null) return null
  return dir === '' ? path.basename(file) : `${dir}/${path.basename(file)}`
}

/** Whether `child` is `parent` or lies under it. */
const isWithin = (parent, child) =>
  child === parent ||
  child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)

/**
 * A write judged by where it lands, for the names a line does not spell: a
 * pattern, a whole directory, or what find and rsync reach. The git dir
 * holds the gate's cache and the plan markers, and .claude holds the
 * owner's escape hatch, so touching them whole is refused; inside the git
 * dir, anything else asks, and so does a directory holding harness paths.
 * `shown` names the write in the reasons; a pattern is told by the word
 * the line spells. An `entry` is placed as itself (judgePlace).
 */
function placeOfWrite(
  shown,
  spelled,
  file,
  repoOf,
  { io, repo: repoLib },
  entry = false,
) {
  const repo = repoOf(repoLib.existingDirOf(entry ? path.dirname(file) : file))
  if (repo == null || !repoLib.isProject(repo)) return null
  const target = entry ? file : repoLib.realPathOf(file)
  const gitDirs = [repo.gitDir, repo.commonDir].map((dir) =>
    repoLib.realPathOf(dir),
  )
  if (gitDirs.some((dir) => target === dir))
    return io.deny(
      `o comando mexe em ${shown}, o diretório git onde ficam o cache do gate e o marcador do plano`,
    )
  if (gitDirs.some((dir) => isWithin(target, dir)))
    return io.ask(
      `o comando mexe em ${shown}, que contém o diretório git onde ficam o cache do gate e o marcador do plano: confira`,
      { critical: true },
    )
  if (gitDirs.some((dir) => isWithin(dir, target))) {
    if (/[*?[{]/.test(path.basename(spelled)))
      return io.deny(
        `o comando mexe em ${shown}, um padrão dentro do diretório git, onde ficam o cache do gate e o marcador do plano`,
      )
    return io.ask(
      `o comando escreve dentro do diretório git (${shown}): confira`,
      {
        critical: true,
      },
    )
  }
  const relative = relativeIn(repo, target, entry, repoLib)
  if (relative === null) return null
  const holds = (inner) =>
    relative === '' || inner === relative || inner.startsWith(`${relative}/`)
  if (holds(`.claude/${settingsLocal}`) && relative !== '')
    return io.deny(
      `o comando mexe em ${shown}, que contém .claude/settings.local.json, a saída de emergência do dono`,
    )
  if (
    !repoLib.isHarnessPath(relative) &&
    repoLib.harnessPaths.some((entry) => holds(entry.replace(/\/$/, '')))
  )
    return io.ask(
      `o comando escreve em ${relative === '' ? '.' : relative}, que contém caminhos do harness: confira`,
      { critical: true },
    )
  return null
}

/**
 * Records what the command leaves in each file it writes, for the commands
 * after it, where the write lands (contentPlace). A write through a link of
 * the line whose destination is not known may have changed any file, so the
 * files the line did not write become unknown; the place the disk alone
 * gives, when a link of the line hides it, and the places a link a command
 * listed later makes may lead to instead, become unknown too.
 */
function recordWrites(writes, cwd, cwdKnown, state) {
  for (const write of writes) {
    const file = pathOf(write.word, cwd, cwdKnown, state)
    if (file === null) continue
    const place = contentPlace(file, state)
    if (place === null) {
      state.untracked = true
      continue
    }
    let content = write.content
    if (write.append) {
      const before = fileText(file, state)
      content =
        before.known && content.known
          ? { known: true, text: `${before.text}${content.text}` }
          : unknownText
    }
    state.written.set(place.key, content)
    for (const other of [place.shadowed, ...place.maybe])
      if (other !== null) state.written.set(other, unknownText)
  }
}

/** The programs that make a link where they would copy, and how they say so. */
const linkMakers = {
  ln: { symbolic: ['-s', '--symbolic'], hard: null },
  cp: { symbolic: ['-s', '--symbolic-link'], hard: ['-l', '--link'] },
  link: null,
}

/** The programs that carry a link they copy or move, as a link. */
const linkCarriers = new Set(['cp', 'mv', 'rsync', 'ditto'])

/**
 * What an entry is when a command runs: 'dir', 'other', 'missing', or
 * 'unknown' when it cannot be told. `follow` follows a last link, as a
 * program that takes a directory through a link does.
 */
function entryKind(file, follow, state) {
  try {
    const placed = places.placeOf(file, {
      followLast: follow,
      lineLink: lineLinkOf(state),
    })
    if (state.links.has(placed.toLowerCase())) return 'other'
    return (follow ? statSync : lstatSync)(placed).isDirectory()
      ? 'dir'
      : 'other'
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'missing'
    if (
      error instanceof UnknownLink ||
      error instanceof places.Unplaceable ||
      typeof error?.code === 'string'
    )
      return 'unknown'
    throw error
  }
}

/**
 * The links a command makes, for the commands after it on the line (Copilot
 * review of #26, eighth round), and the files it gives a new name to by a
 * hard link:
 * - `ln` (symbolic with -s, hard without), `link`, and `cp -s` and `cp -l`,
 *   which link in place of copying;
 * - `cp`, `mv`, `rsync` and `ditto` carry a link they copy or move, and the
 *   links the line made inside a directory they copy or move;
 * - `rsync --link-dest` hard-links from its directory.
 * mklink is cmd.exe's own, not a program a shell line runs.
 *
 * Each link is { at, to, text }: `at` where the new entry lies, `to` where
 * it leads as placeOf reads it (a symlink's text, read from its own
 * directory; for a hard link, the source's absolute path, since it is the
 * same file under another name), null when the source holds an expansion,
 * and `text` the source as spelled. Where the program would put the link is
 * placed as it places it: in a directory named last, under the source's
 * name, or as the last name itself; when the hook cannot tell which, both.
 * A link over an existing entry is made only with the options that replace
 * it. A link whose place cannot be read is not recorded: the write that makes
 * it already asks, since its place is unknown.
 * @returns {{ links: { at: string, to: string | null, text: string }[], hardSources: { value: string, known: boolean }[] }}
 */
function linksMadeBy(command, cwd, cwdKnown, state) {
  const program = programOf(command)
  const made = { links: [], hardSources: [] }
  if (!Object.hasOwn(linkMakers, program) && !linkCarriers.has(program))
    return made
  const spec = copyPrograms[program] ?? { short: '', long: [], target: [] }
  const { operands, targets, flags, linkSources } = copyOperands(command, spec)
  const has = (names) => names?.some((name) => flags.has(name)) ?? false
  const maker = linkMakers[program]
  let kind = 'carry'
  if (program === 'link') kind = 'hard'
  else if (program === 'ln') kind = has(maker.symbolic) ? 'symbolic' : 'hard'
  else if (program === 'cp' && has(maker.symbolic)) kind = 'symbolic'
  else if (program === 'cp' && has(maker.hard)) kind = 'hard'
  // ln, cp -s and cp -l refuse an existing entry without these (a backup
  // moves it aside first); a copy or a move replaces it, which is the side
  // that keeps the link.
  const replaces =
    kind === 'carry' ||
    has([
      '-f',
      '--force',
      '--remove-destination',
      '-i',
      '--interactive',
      '-b',
      '--backup',
    ])
  const noDereference = has(['-n', '-h', '--no-dereference'])
  const lineLink = lineLinkOf(state)

  // Where the links go: into `dir` under each source's name, or at `last`
  // for a single source (into it, when it is a directory).
  let dir = targets.at(-1) ?? null
  let sources = operands
  let last = null
  if (program === 'link') {
    sources = operands.slice(0, 1)
    last = operands[1] ?? null
  } else if (dir === null && operands.length === 1 && program === 'ln')
    dir = { value: '.', known: true }
  else if (dir === null && operands.length > 1) {
    sources = operands.slice(0, -1)
    if (sources.length === 1) last = operands.at(-1)
    else dir = operands.at(-1)
  }
  const placesFor = (source) => {
    const base = path.basename(source.value)
    if (dir !== null) {
      const at = pathOf(dir, cwd, cwdKnown, state)
      return at === null ? [] : [path.join(at, base)]
    }
    const at = last === null ? null : pathOf(last, cwd, cwdKnown, state)
    if (at === null) return []
    // -T takes the last name as the link itself, never as a directory to put
    // it in (with -t or a single operand, the program refuses the line).
    if (has(['-T', '--no-target-directory']) || program === 'link') return [at]
    const found = entryKind(at, !noDereference, state)
    if (found === 'dir') return [path.join(at, base)]
    if (found === 'other') return [at]
    return [at, path.join(at, base)]
  }

  const record = (at, to, text) => {
    let entry
    try {
      entry = places.placeOf(at, { followLast: false, lineLink })
    } catch (error) {
      if (error instanceof UnknownLink || error instanceof places.Unplaceable)
        return
      throw error
    }
    if (!replaces && entryKind(at, false, state) !== 'missing') return
    made.links.push({ at: entry, to, text })
  }

  for (const source of sources) {
    const text = source.value
    if (kind === 'symbolic' || kind === 'hard') {
      let to
      if (kind === 'hard' || has(['-r', '--relative']))
        to = pathOf(source, cwd, cwdKnown, state)
      else to = readablePath(source, pwdOf(cwd, cwdKnown, state))
      if (kind === 'hard') made.hardSources.push(source)
      for (const at of placesFor(source)) record(at, to, text)
      continue
    }
    // A copy or a move: the links it carries.
    const from = pathOf(source, cwd, cwdKnown, state)
    if (from === null) continue
    let entry
    try {
      entry = places.placeOf(from, { followLast: false, lineLink })
    } catch (error) {
      if (error instanceof UnknownLink || error instanceof places.Unplaceable)
        continue
      throw error
    }
    const key = entry.toLowerCase()
    const within = (links) =>
      [...links]
        .filter(([at]) => at === key || at.startsWith(`${key}/`))
        .map(([at, link]) => ({ suffix: at.slice(key.length), link }))
    const carried = within(state.links)
    if (carried.length === 0)
      try {
        if (lstatSync(entry).isSymbolicLink()) {
          const to = readlinkSync(entry)
          carried.push({ suffix: '', link: { to, text: to } })
        }
      } catch {
        // Not there, or not readable: nothing to carry.
      }
    // A link a command listed later makes there may be what the copy
    // carries instead (state.laterLinks): where each carried link leads is
    // then not known.
    const later = within(state.laterLinks)
    carried.push(...later)
    for (const at of placesFor(source))
      for (const { suffix, link } of carried)
        record(`${at}${suffix}`, later.length > 0 ? null : link.to, link.text)
  }

  // rsync --link-dest: a relative directory is read from the destination.
  const destination = operands.length > 1 ? operands.at(-1) : null
  for (const source of linkSources) {
    made.hardSources.push(source)
    if (destination !== null && !path.isAbsolute(source.value))
      made.hardSources.push({
        value: path.join(destination.value, source.value),
        known: source.known && destination.known,
      })
  }
  return made
}

/** Records the links a command made, for the commands after it. */
function recordLinks(made, state) {
  for (const [key, link] of linkMap(made.links)) state.links.set(key, link)
}

/** Links as state.links keeps them: by the entry, lowercased. */
const linkMap = (links) =>
  new Map(links.map(({ at, to, text }) => [at.toLowerCase(), { to, text }]))

// ---------------------------------------------------------------------------
// Commands inside commands

/** An unknown word in a text to be parsed again: the parser reads it as an expansion. */
const unknownWord = '"${ARGUMENTO}"'
const quoteWord = (word) =>
  word.known
    ? `'${word.value.replaceAll("'", "'\\''").replaceAll('{}', `'${unknownWord}'`)}'`
    : unknownWord

/**
 * A command reached through `xargs`: its argv lacks what xargs appends, or
 * substitutes for the replace string, so those words are unknown. Read from
 * the wrappers shell.mjs took off, still in the command's text.
 */
function throughXargs(command) {
  const { words } = scanText(command.text ?? '')
  const argv = command.argv.map(String)
  if (words.length <= argv.length) return command
  const prefix = words.slice(0, words.length - argv.length)
  const at = prefix.findIndex((word) =>
    ['xargs', 'gxargs'].includes(path.basename(word.value)),
  )
  if (at < 0) return command
  let replace = null
  const options = prefix.slice(at + 1).map((word) => word.value)
  for (const [index, option] of options.entries()) {
    if (option === '-I' || option === '-J') replace = options[index + 1] ?? null
    else if (/^-[IJ]./.test(option)) replace = option.slice(2)
    else if (option === '-i' || option === '--replace') replace = '{}'
    else if (option.startsWith('-i')) replace = option.slice(2)
    else if (option.startsWith('--replace=')) replace = option.slice(10)
  }
  const known = argv.map(
    (word, index) =>
      command.known?.[index] !== false &&
      (replace === null || replace === '' || !word.includes(replace)),
  )
  if (replace !== null) return { ...command, known }
  return {
    ...command,
    argv: [...argv, '${VINDO_DO_XARGS}'],
    known: [...known, false],
  }
}

/** How a shell takes its script: `-c` (already parsed), a file operand, or stdin. */
function shellInput(command) {
  const argv = command.argv.map(String)
  let k = 1
  let fromStdin = false
  while (k < argv.length) {
    const arg = argv[k]
    if (arg === '--' || arg === '-') {
      k += 1
      break
    }
    if (arg.startsWith('--')) {
      k += arg === '--rcfile' || arg === '--init-file' ? 2 : 1
      continue
    }
    if ((arg.startsWith('-') || arg.startsWith('+')) && arg.length > 1) {
      if (arg.includes('c')) return { kind: 'inline' }
      if (arg.includes('s')) fromStdin = true
      k += /[oO]/.test(arg) ? 2 : 1
      continue
    }
    break
  }
  if (!fromStdin && k < argv.length)
    return {
      kind: 'file',
      value: argv[k],
      known: command.known?.[k] !== false,
    }
  return { kind: 'stdin' }
}

/**
 * The script operand of a shell's `-c`, as { value, known }, or null: the
 * first operand after the options, as bash and sh take it. For a program the
 * hook could not name, read as a shell; shell.mjs reads the ones it names.
 */
function inlineScript(command) {
  const argv = command.argv.map(String)
  let k = 1
  let inline = false
  while (k < argv.length) {
    const arg = argv[k]
    if (arg === '--' || arg === '-') {
      k += 1
      break
    }
    if (arg.startsWith('--')) {
      k += arg === '--rcfile' || arg === '--init-file' ? 2 : 1
      continue
    }
    if ((arg.startsWith('-') || arg.startsWith('+')) && arg.length > 1) {
      if (arg.includes('c')) inline = true
      k += /[oO]/.test(arg) ? 2 : 1
      continue
    }
    break
  }
  if (!inline || k >= argv.length) return null
  return { value: argv[k], known: command.known?.[k] !== false }
}

/**
 * The programs a command whose program the hook cannot name is judged as:
 * each one the rules know. `sh` stands for every shell.
 */
const unresolvedAs = ['gh', 'git', 'sh']

/**
 * A copy of what the line left so far, for a reading of a command that may
 * not run as read: what it would leave is thrown away with the copy. The
 * cache of git's config answers is shared, since it holds only answers.
 */
function cloneState(from) {
  return {
    ...from,
    exported: { ...from.exported },
    heads: new Map(from.heads),
    lineConfig: [...from.lineConfig],
    ghAliases: new Map(from.ghAliases),
    written: new Map(from.written),
    links: new Map(from.links),
    laterLinks: new Map(from.laterLinks),
    remotes: new Map(
      [...from.remotes].map(([key, seen]) => [
        key,
        { ...seen, repos: [...seen.repos] },
      ]),
    ),
    evaluators: [...from.evaluators],
    opaque: [...from.opaque],
  }
}

/** Programs whose run under find -exec may remove or write the files it finds. */
const findWriters = new Set([
  'rm',
  'unlink',
  'shred',
  'rmdir',
  'truncate',
  'mv',
  'cp',
  'ln',
  'install',
  'rsync',
  'tee',
  'sed',
  'gsed',
  'chmod',
  'dd',
  'sh',
  'bash',
  'zsh',
])

/** Whether a find line deletes, or runs a writer on what it finds. */
function findRemoves(argv) {
  return argv.some(
    (arg, k) =>
      arg === '-delete' ||
      (['-exec', '-execdir', '-ok', '-okdir'].includes(argv[k - 1] ?? '') &&
        findWriters.has(path.basename(arg))),
  )
}

/** The start paths of a find line: the words before its first expression, or `.`. */
function findStartPaths(command) {
  const argv = command.argv.map(String)
  let k = 1
  while (k < argv.length && /^-(?:[HLP]|O\d*)$/.test(argv[k])) k += 1
  if (argv[k] === '-D') k += 2
  const paths = []
  for (; k < argv.length; k += 1) {
    const arg = argv[k]
    if (
      (arg.startsWith('-') && arg !== '-') ||
      ['(', ')', '!', ','].includes(arg)
    )
      break
    paths.push({ value: arg, known: command.known?.[k] !== false })
  }
  return paths.length > 0 ? paths : [{ value: '.', known: true }]
}

/** The commands `find -exec` runs, as a text to parse: `{}` is unknown. */
function findScripts(command) {
  const argv = command.argv.map(String)
  const scripts = []
  for (let k = 1; k < argv.length; k += 1) {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(argv[k])) continue
    const words = []
    let j = k + 1
    while (j < argv.length && argv[j] !== ';' && argv[j] !== '+') {
      words.push({ value: argv[j], known: command.known?.[j] !== false })
      j += 1
    }
    scripts.push({
      text: words.map(quoteWord).join(' '),
      elsewhere: argv[k].endsWith('dir'),
    })
    k = j
  }
  return scripts
}

/** The command `watch` runs: its words joined, run by sh (or as they are with -x). */
function watchScript(command) {
  const argv = command.argv.map(String)
  let k = 1
  let exec = false
  while (k < argv.length && argv[k].startsWith('-')) {
    if (['-n', '--interval', '-q', '--equexit'].includes(argv[k])) k += 1
    if (argv[k] === '-x' || argv[k] === '--exec') exec = true
    k += 1
  }
  const words = argv.slice(k).map((value, offset) => ({
    value,
    known: command.known?.[k + offset] !== false,
  }))
  return exec
    ? words.map(quoteWord).join(' ')
    : words.map((w) => w.value).join(' ')
}

// ---------------------------------------------------------------------------
// The line

/** The directory the command line starts in: run_in_terminal's own cwd, else the session's. */
function baseDirOf(input, toolInput) {
  const inputCwd =
    typeof input.cwd === 'string' && input.cwd !== ''
      ? input.cwd
      : process.cwd()
  return typeof toolInput.cwd === 'string' && toolInput.cwd !== ''
    ? path.resolve(inputCwd, toolInput.cwd)
    : inputCwd
}

const maxDepth = 6

async function decide(input, libs) {
  const { io, shell, gh, git, repo, budget } = libs
  const toolInput =
    input.tool_input !== null && typeof input.tool_input === 'object'
      ? input.tool_input
      : {}
  const text = toolInput.command
  if (typeof text !== 'string') return io.pass()
  const base = baseDirOf(input, toolInput)
  const parsed = shell.parseCommand(text)
  budget.startBudget('guard-bash')
  // One live client per GitHub host, made when a rule first reads it: each
  // command's reads go to the host that command goes to, never to the one
  // the hook's own environment names (Copilot review of #26, fifth round).
  // They authenticate with the hook's environment, never with a token the
  // command sets; a command that may run gh with another account is not
  // read at all (gh-rules' accountChange; ninth round).
  const githubFor = gh.githubClients()

  // One repoAt per directory, and only when a rule asks for it: `gh issue
  // view` costs no git call, and a line of five gh commands costs one. It
  // runs with the environment the hook inherited, which is the one each
  // command inherits too; a gh command that gives git a config of its own
  // (GIT_CONFIG_*, HOME, XDG_CONFIG_HOME) is read again with it, in
  // gh-rules' remotesRepo, not from this cache (Copilot review of #26,
  // seventh round).
  const repos = new Map()
  const repoOf = (dir) => {
    if (!repos.has(dir)) repos.set(dir, repo.repoAt(dir))
    return repos.get(dir)
  }

  // The repository around a place a write lands, once per real directory: a
  // write is judged where it is spelled and where its links lead, which
  // mostly share a directory under two spellings (/tmp and /private/tmp on
  // macOS), and git answers from the real one.
  const placed = new Map()
  const repoOfPlace = (dir) => {
    const key = repo.realPathOf(repo.existingDirOf(dir))
    if (!placed.has(key)) placed.set(key, repoOf(dir))
    return placed.get(key)
  }

  // What the commands already judged leave for the ones after them. A
  // program the hook cannot name is judged on copies of it (judgeUnresolved).
  let state = {
    exported: {},
    heads: new Map(),
    headsLost: false,
    lineConfig: [],
    ghAliases: new Map(),
    written: new Map(),
    // The links earlier commands made (linksMadeBy), by the real path of
    // the entry, lowercased: { to, text }, `to` null when not known.
    links: new Map(),
    // The same for the links the commands listed after the one being judged
    // make, which may run first (judgeLine).
    laterLinks: new Map(),
    // Whether `$PWD` is the directory a command runs in: false once the
    // line may give PWD a value of its own.
    pwdKnown: !setsPwd(text),
    // What earlier commands did to the remotes gh picks its repository from:
    // per common git dir, whether the change can be followed, and the
    // repositories origin may name now (the disk's, then each new URL). Lost
    // when a change lands where the hook cannot tell.
    remotes: new Map(),
    remotesLost: false,
    // Whether a command of the line may switch the account gh runs as (gh
    // auth login, logout, switch, refresh, gh config set): the live reads,
    // made with the hook's account, then judge no gh command of the line
    // (Copilot review of #26, ninth round).
    accountSwitched: false,
    evaluators: [],
    opaque: [],
    // Set once a program the hook does not read has run: from then on, a
    // file the line did not write itself holds what that program left.
    untracked: false,
    cache: new Map(),
  }
  // What a rule finds in a file: what the line wrote where it lands, else
  // undefined for the rule to read the disk; where a link of the line leads
  // elsewhere than the disk's, what the disk holds there.
  const files = (file) => {
    const place = contentPlace(path.resolve(file), state)
    if (!certain(place)) return unknownText
    const written = writtenAt(place.key, state)
    if (written !== undefined) return written
    if (state.untracked) return unknownText
    return place.shadowed === null ? undefined : fileText(place.key, state)
  }
  const adjust = (info) => {
    if (info == null) return info
    if (state.headsLost) return { ...info, branch: null, branchKnown: false }
    const head = state.heads.get(info.gitDir)
    return head === undefined
      ? info
      : { ...info, branch: head.branch, branchKnown: head.known }
  }

  /**
   * Records what a git command changes in the remotes (Copilot review of
   * #26). A change in a config every repository reads, in a directory the
   * hook cannot read, or outside a repository (a `git init` earlier on the
   * line may make one) leaves every repository's remotes unknown.
   */
  const recordRemote = (change) => {
    if (change.everywhere || !change.dirKnown || !existsSync(change.dir)) {
      state.remotesLost = true
      return
    }
    const info = repoOf(change.dir)
    if (info == null) {
      state.remotesLost = true
      return
    }
    const seen = state.remotes.get(info.commonDir) ?? {
      known: true,
      repos: [info.repo],
    }
    if (change.origin === null || !change.origin.known) seen.known = false
    else seen.repos.push(repo.repoFromRemote(change.origin.url))
    state.remotes.set(info.commonDir, seen)
  }

  /**
   * The repository gh finds around a directory, after what earlier commands
   * of the line did to the remotes. With no change, origin as the disk has
   * it. With changes the hook follows, this project when origin named it or
   * may name it now (a change may fail, and `git remote add` of a name that
   * exists does, leaving the old URL), else the last URL. With a change it
   * cannot follow, remoteKnown false: gh-rules then judges the command as
   * this project, never as another repository. Any change sets
   * remotesChanged: a command that gives git a config of its own is read
   * again from the disk with it (gh-rules' remotesRepo), which would miss
   * what the line changed before it (Copilot review of #26, seventh round).
   */
  const withRemotes = (info) => {
    if (state.remotesLost)
      return {
        ...(info ?? {
          top: null,
          gitDir: null,
          commonDir: null,
          branch: null,
          branchKnown: false,
        }),
        repo: null,
        remoteKnown: false,
      }
    if (info == null) return info
    const seen = state.remotes.get(info.commonDir)
    if (seen === undefined) return info
    if (!seen.known)
      return { ...info, repo: null, remoteKnown: false, remotesChanged: true }
    return {
      ...info,
      repo:
        seen.repos.find((name) => repo.isProject(name)) ?? seen.repos.at(-1),
      remotesChanged: true,
    }
  }

  const parseScript = async (script, cwd, cwdKnown, depth) => {
    if (setsPwd(script)) state.pwdKnown = false
    const inner = shell.parseCommand(script)
    const decisions = []
    if (inner.unparsable && mentionsGhOrGit(script))
      decisions.push(
        unread(io, 'não consegui ler inteiro o script que o comando roda'),
      )
    for (const command of inner.commands)
      decisions.push(...(await judge(command, cwd, cwdKnown, depth + 1)))
    return decisions
  }

  /**
   * What a command's program does, judged by its name: gh and git by their
   * rules, a shell, find and watch by the commands they run.
   */
  const judgeProgram = async (command, cwd, cwdKnown, depth) => {
    const decisions = []
    const env = { ...process.env, ...command.env }
    const program = programOf(command)

    const gitCtx = {
      cwd,
      cwdKnown,
      env: process.env,
      repoAt: (dir) => adjust(repoOf(dir)),
      lineConfig: state.lineConfig,
      files,
      cache: state.cache,
      // The session whose plan marker a write to the worktree reads, as
      // build-guard reads it for an edit.
      input,
    }

    state.evaluators.push(...evaluatorsOf(command, gitCtx, libs, state))
    if (program === 'git') {
      decisions.push(git.gitDecision(command, gitCtx))
      const change = git.headChangeOf(command, gitCtx)
      if (change !== null) {
        const moved = change.dirKnown ? repoOf(change.dir) : null
        if (!change.dirKnown) state.headsLost = true
        else if (moved != null) state.heads.set(moved.gitDir, change.head)
      }
      state.lineConfig.push(...git.configSetBy(command, gitCtx))
      const remote = git.remoteChangeOf(command, gitCtx)
      if (remote !== null) recordRemote(remote)
    } else if (program === 'gh') {
      // gh finds its repository through git, so GIT_DIR moves it too.
      const found = gh.ghRepoDir(env, cwd)
      const dirKnown = cwdKnown && found.known
      const where = found.dir
      const ctx = {
        cwd,
        cwdKnown: dirKnown,
        permissionMode: input.permission_mode,
        githubFor,
        env: process.env,
        accountSwitched: state.accountSwitched,
        files,
        ghAliases: state.ghAliases,
        judgeOther: async (other, otherCtx) =>
          io.combine(
            await judge(
              { ...other, cwd: null },
              otherCtx.cwd,
              otherCtx.cwdKnown !== false,
              depth + 1,
            ),
          ),
      }
      Object.defineProperty(ctx, 'repo', {
        enumerable: true,
        get: () => withRemotes(adjust(repoOf(where))),
      })
      decisions.push(await gh.ghDecision(command, ctx))
      // An alias the line defined is known only now: one that switches the
      // account does so for the commands after it (ninth round).
      if (gh.ghSwitchesAccount(command, ctx)) state.accountSwitched = true
      for (const [name, expansion] of gh.ghAliasDefinitions(command, ctx))
        state.ghAliases.set(name, expansion)
      if (gh.ghMovesHead(command, ctx)) {
        const moved = dirKnown ? repoOf(where) : null
        if (moved == null) state.headsLost = true
        else state.heads.set(moved.gitDir, { known: false, branch: null })
      }
    } else if (shells.has(program)) {
      const script = shellInput(command)
      if (script.kind === 'inline') {
        // shell.mjs reads the `-c` script of a shell it can name; for a
        // program it could not name, judged as a shell, it is read here.
        const inline =
          command.unresolved === true ? inlineScript(command) : null
        if (inline?.known)
          decisions.push(
            ...(await parseScript(inline.value, cwd, cwdKnown, depth)),
          )
        else if (inline !== null && mentionsGhOrGit(text))
          decisions.push(
            unread(
              io,
              `não consegui ler o script que o ${program} roda: confira que ele não roda um gh ou um git que o hook nega`,
            ),
          )
      } else if (
        script.kind === 'file' ||
        (script.kind === 'stdin' && command.stdinFile)
      ) {
        const spelled =
          script.kind === 'file' ? script.value : command.stdinFile
        const read =
          (script.kind === 'file' && !script.known) || !cwdKnown
            ? unknownText
            : fileText(path.resolve(cwd, spelled), state)
        if (read.known)
          decisions.push(
            ...(await parseScript(read.text, cwd, cwdKnown, depth)),
          )
        else {
          state.opaque.push(`${program} ${spelled}`)
          if (mentionsGhOrGit(text))
            decisions.push(
              unread(
                io,
                `não consegui ler o script que o ${program} roda (${spelled}): confira que ele não roda um gh ou um git que o hook nega`,
              ),
            )
        }
      } else if (script.kind === 'stdin' && command.stdin === null) {
        state.opaque.push(`${program} lendo um pipe`)
        if (mentionsGhOrGit(text))
          decisions.push(
            unread(
              io,
              `o ${program} roda o que chega pelo pipe, que o hook não lê: confira que não é um gh ou um git que o hook nega`,
            ),
          )
      } else if (script.kind === 'stdin' && command.unresolved === true) {
        // A heredoc or a here-string: shell.mjs reads it for a shell it can
        // name; here it is the script of a program it could not.
        if (command.stdinKnown !== false)
          decisions.push(
            ...(await parseScript(command.stdin, cwd, cwdKnown, depth)),
          )
        else if (mentionsGhOrGit(text))
          decisions.push(
            unread(
              io,
              `não consegui ler o script que o ${program} lê do stdin: confira que ele não roda um gh ou um git que o hook nega`,
            ),
          )
      }
    } else if (program === 'find') {
      for (const script of findScripts(command))
        decisions.push(
          ...(await parseScript(
            script.text,
            cwd,
            cwdKnown && !script.elsewhere,
            depth,
          )),
        )
    } else if (program === 'watch') {
      decisions.push(
        ...(await parseScript(watchScript(command), cwd, cwdKnown, depth)),
      )
    } else if (program === 'parallel') {
      state.opaque.push('parallel')
      if (mentionsGhOrGit(text))
        decisions.push(
          unread(
            io,
            'o parallel monta comandos que o hook não lê: confira que não é um gh ou um git que o hook nega',
          ),
        )
    }
    return decisions
  }

  /**
   * A program whose name is an expansion the hook cannot read (`$CMD`,
   * `"$(command -v gh)"`; Copilot review of #26) is judged as each program
   * the rules know: gh, git, and a shell running its words (`$SH -c …`, a
   * script file, a heredoc). Evaluators (`node -e`) are the tripwire's, which
   * counts such a program as able to do anything. Each reading runs on a copy
   * of what the line left so far, since which one runs is not known. The
   * worst reading wins, but the program is uncertain: a deny or a critical
   * ask becomes a critical ask, which the autonomous modes refuse; a plain
   * ask stays plain; when every reading passes, the command passes.
   */
  const judgeUnresolved = async (command, cwd, cwdKnown, depth) => {
    const saved = state
    const readings = []
    for (const program of unresolvedAs) {
      state = cloneState(saved)
      try {
        const candidate = {
          ...command,
          argv: [program, ...command.argv.slice(1)],
          known: command.argv.map(
            (_, index) => index === 0 || command.known?.[index] !== false,
          ),
          unresolved: true,
        }
        readings.push({
          program,
          decision: io.combine(
            await judgeProgram(candidate, cwd, cwdKnown, depth),
          ),
        })
      } finally {
        state = saved
      }
    }
    const worst = io.combine(readings.map((reading) => reading.decision))
    if (worst.decision === 'pass') return io.pass()
    const level = (decision) =>
      decision.decision === 'deny'
        ? 3
        : decision.decision === 'ask'
          ? decision.critical === true
            ? 2
            : 1
          : 0
    const top = level(worst)
    const reasons = readings
      .filter((reading) => level(reading.decision) === top)
      .map((reading) => `como ${reading.program}: ${reading.decision.reason}`)
    return io.ask(
      `não consegui ler o programa que o comando roda em "${command.argv[0]}", e ele pode ser um dos que o hook confere (${reasons.join('; ')}): confira que não é`,
      { critical: top >= 2 },
    )
  }

  const judge = async (original, base, baseKnown, depth) => {
    if (depth > maxDepth)
      return [
        unread(
          io,
          'comandos dentro de comandos demais: confira o que a linha roda',
        ),
      ]
    const decisions = []
    const cwd = path.resolve(base, original.cwd ?? '.')
    // A directory spelled in full still names the files written in it; the
    // rules also need it to exist, since the repository around it decides.
    const cwdSpelled = baseKnown && !/[$`]/.test(original.cwd ?? '')
    const cwdKnown = cwdSpelled && existsSync(cwd)
    // `HOME=/x; gh …`: what a standalone assignment before it may have
    // changed in its environment, unknown (seventh round).
    shell.recordAssignments(original, state.exported)
    const command = throughXargs({
      ...original,
      env: { ...state.exported, ...original.env },
    })

    if (command.known?.[0] === false) {
      state.opaque.push(command.argv[0])
      decisions.push(await judgeUnresolved(command, cwd, cwdKnown, depth))
    } else {
      decisions.push(...(await judgeProgram(command, cwd, cwdKnown, depth)))
      shell.recordExports(command, state.exported)
    }

    if (state.evaluators.length > 0 || state.opaque.length > 0)
      state.untracked = true
    const writes = writesOf(command, cwd, state)
    for (const write of writes)
      decisions.push(
        protectedWrite(write, cwd, cwdSpelled, repoOfPlace, libs, state),
      )
    // A hard link is the same file under a new name: making one to a file
    // of the loop is judged as writing that file.
    const made = linksMadeBy(command, cwd, cwdSpelled, state)
    for (const word of made.hardSources)
      decisions.push(
        protectedWrite(
          { word, content: unknownText, hardLink: true },
          cwd,
          cwdSpelled,
          repoOfPlace,
          libs,
          state,
        ),
      )
    recordWrites(writes, cwd, cwdSpelled, state)
    recordLinks(made, state)
    // `read PWD`, `export PWD=…`: a word that gives PWD a value, however the
    // line quotes it, leaves `$PWD` unknown for the commands after it.
    if (command.argv.some((word) => setsPwd(word))) state.pwdKnown = false
    return decisions
  }

  /** Judges every command of the line, in order, into `decisions`. */
  const judgeLine = async (decisions) => {
    // A substitution runs before the command that holds it, but is judged
    // after the line's own commands: so a program that may write files unseen
    // anywhere on the line makes the files the line did not write unknown
    // from the start.
    if (parsed.commands.some(writesUnseen)) state.untracked = true

    // The same for the remotes: a git inside a substitution or a `bash -c` is
    // listed after the gh commands it may run before. When a git that changes
    // the remotes is listed after a gh, that gh cannot read its repository
    // from the disk.
    const firstGh = parsed.commands.findIndex(
      (command) => programOf(command) === 'gh',
    )
    if (
      firstGh >= 0 &&
      parsed.commands.slice(firstGh + 1).some(
        (command) =>
          programOf(command) === 'git' &&
          command.known?.[0] !== false &&
          git.remoteChangeOf(command, {
            cwd: path.resolve(base, command.cwd ?? '.'),
            cwdKnown: false,
            env: process.env,
            lineConfig: [],
            cache: state.cache,
          }) !== null,
      )
    )
      state.remotesLost = true

    // The same for the account gh runs as (Copilot review of #26, ninth
    // round), with no change the hook can follow: a gh auth login, logout,
    // switch or refresh, or a gh config set, anywhere on the line may run
    // before any gh of it (a substitution, a `bash -c`), and which account it
    // leaves is not read. So no gh command of such a line is read live with
    // the hook's account: a rule that needed the read asks, critical.
    if (
      parsed.commands.some(
        (command) =>
          programOf(command) === 'gh' &&
          command.known?.[0] !== false &&
          gh.ghSwitchesAccount(command, {
            env: process.env,
            ghAliases: new Map(),
          }),
      )
    )
      state.accountSwitched = true

    // The same for the links (Copilot review of #26, eighth round): a link a
    // substitution or a `bash -c` script makes may be there before a command
    // listed ahead of it writes or reads through it. The links each command
    // makes are read first, in order, on a copy of the state; each command is
    // then judged with those the commands listed after it make as links that
    // may be there (state.laterLinks).
    const ahead = cloneState(state)
    const made = parsed.commands.map((command) => {
      const { links } = linksMadeBy(
        throughXargs(command),
        path.resolve(base, command.cwd ?? '.'),
        !/[$`]/.test(command.cwd ?? ''),
        ahead,
      )
      recordLinks({ links }, ahead)
      return links
    })

    for (const [index, command] of parsed.commands.entries()) {
      state.laterLinks = linkMap(made.slice(index + 1).flat())
      decisions.push(...(await judge(command, base, true, 0)))
    }
  }

  // A budget spent halfway keeps what the commands judged so far decided: a
  // deny among them still wins over the budget's critical ask.
  const decisions = []
  try {
    await judgeLine(decisions)
  } catch (error) {
    if (!(error instanceof budget.BudgetExhausted)) throw error
    decisions.push(io.ask(error.message, { critical: true }))
    return io.combine(decisions)
  }

  // A program the hook does not read, and an evaluator found only in the
  // raw text of a line that did not parse, count as able to do anything.
  const evaluators = [
    ...state.evaluators,
    ...state.opaque.map((name) => ({
      name: `${name}, que o hook não lê`,
      capable: true,
    })),
  ]
  if (parsed.unparsable)
    evaluators.push(
      ...rawEvaluators
        .filter(({ pattern }) => pattern.test(text))
        .map(({ name }) => ({ name, capable: true })),
    )
  decisions.push(tripwire(text, evaluators, libs))
  if (parsed.unparsable && mentionsGhOrGit(text))
    decisions.push(unread(io, 'não consegui ler o comando inteiro'))
  return io.combine(decisions)
}

let io = null
try {
  io = await import('./lib/io.mjs')
  const [shell, gh, git, repo, loop, budget] = await Promise.all([
    import('./lib/shell.mjs'),
    import('./lib/gh-rules.mjs'),
    import('./lib/git-rules.mjs'),
    import('./lib/repo.mjs'),
    import('../../scripts/loop-sections.mjs'),
    import('./lib/budget.mjs'),
  ])
  places = repo
  const input = await io.readInput()
  const decision =
    input === null
      ? io.deny('a entrada do hook não pôde ser lida')
      : io.resolve(
          await decide(input, { io, shell, gh, git, repo, loop, budget }),
          input.permission_mode,
        )
  process.stdout.write(io.preToolUseOutput(decision))
} catch (error) {
  const reason = `o hook falhou: ${error instanceof Error ? error.message : String(error)}`
  if (io === null) {
    process.stderr.write(`hooks do loop: ${reason}\n`)
    process.exitCode = 2
  } else process.stdout.write(io.preToolUseOutput(io.deny(reason)))
}
