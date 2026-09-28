// The rules for `git` (#5): nothing lands on main but through a pull
// request, no commit message turns the checks off, and no git command
// writes the worktree where an edit could not (fourth round, below).
//
// The gate and the audit of main see a commit on main, or a push that skipped
// its checks, only after it happened. These rules stop the two before git
// runs: a commit, merge, cherry-pick, revert or am while main is checked
// out; a push whose destination is main; and a commit message carrying one
// of the strings that make GitHub skip the push's runs.
//
// The repository is the one git would use for the command: the one around
// the command's directory (after every `-C`), or the one `--git-dir` or
// GIT_DIR names, never the session's. A session opened in the main checkout
// commits in worktrees, and each worktree has its own branch. A push is
// judged by where it lands: the remote it names, read through git's own
// config, not the repository it starts from.
//
// git reads more than its argv: an alias, a `-c` or the repository's config
// can turn `git p` into a push to main, or `git push` with no refspec into
// one. So the subcommand is read after git's own options, an alias is
// expanded as git would, and a push with no refspec asks git's config where
// it goes. What cannot be read asks.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  skipChecksTrailer,
  skipCiTokens,
} from '../../../scripts/loop-sections.mjs'
import { afterSpawn, spawnTimeout } from './budget.mjs'
import {
  editDecision,
  fold,
  intentDir,
  settingsLocal,
  within,
} from './edit-gate.mjs'
import { ask, combine, deny, pass } from './io.mjs'
import {
  harnessPaths,
  isProject,
  realPathOf,
  repoFromRemote,
  trunk,
} from './repo.mjs'
import { parseCommand, readBody } from './shell.mjs'

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * What the hook cannot read (a message behind an expansion, a file it cannot
 * open, a directory, a branch, a refspec, the config a push depends on)
 * inside a rule that refuses what it can read: it asks, critical, so the
 * modes where nobody is asked refuse it instead of letting it through
 * unseen (Copilot review of #26, third round).
 */
const unread = (reason) => ask(reason, { critical: true })

/**
 * The trailer, read the way GitHub reads it: `skip-checks: true` and
 * `skip-checks:true` both skip the runs, in any case. Built from the
 * contract's text, so the two cannot drift apart. It is matched anywhere in
 * the message, not only as the last paragraph GitHub requires: a trailer one
 * edit away from working is refused as well.
 */
const trailerPattern = (() => {
  const at = skipChecksTrailer.indexOf(':')
  const key = skipChecksTrailer.slice(0, at).trim()
  const value = skipChecksTrailer.slice(at + 1).trim()
  return new RegExp(
    `${escapeRegExp(key)}[ \\t]*:[ \\t]*${escapeRegExp(value)}`,
    'i',
  )
})()

/**
 * The first skip string in a text: one of skipCiTokens, compared without
 * case, or skipChecksTrailer. Null when there is none, or when the text is
 * not a string (a message that could not be read).
 */
export function skipTokenIn(text) {
  if (typeof text !== 'string') return null
  const folded = text.toLowerCase()
  const token = skipCiTokens.find((candidate) =>
    folded.includes(candidate.toLowerCase()),
  )
  if (token !== undefined) return token
  return trailerPattern.test(text) ? skipChecksTrailer : null
}

const stdinNames = new Set(['-', '/dev/stdin', '/dev/fd/0'])

/**
 * The text a command reads from a path (`-F file`, `--body-file file`,
 * `field=@file`), where `-` and /dev/stdin are the command's stdin. It is
 * shell.mjs's readBody on a one-option command, so a file and a stdin are read
 * under the same limits everywhere: unknown when the word holds an expansion,
 * the file is missing, not regular or too big, or stdin is a pipe.
 *
 * `files`, when given, answers first for a path an earlier command of the
 * same line writes (guard-bash): what the file holds when this command runs
 * is what that command wrote, not what is on disk while the hook reads it.
 * @param {((file: string) => { known: boolean, text: string | null } | undefined) | null} [files]
 * @returns {{ known: boolean, text: string | null }}
 */
export function readSource(command, dir, value, known = true, files = null) {
  if (known !== false && typeof files === 'function') {
    const raw = String(value)
    const file = stdinNames.has(raw)
      ? typeof command?.stdinFile === 'string'
        ? path.resolve(dir, command.stdinFile)
        : null
      : path.resolve(dir, raw)
    const written = file === null ? undefined : files(file)
    if (written !== undefined)
      return { known: written.known, text: written.known ? written.text : null }
  }
  const read = readBody(
    {
      argv: ['source', '--from', String(value)],
      known: [true, true, known !== false],
      cwd: null,
      stdin: command?.stdin ?? null,
      stdinKnown: command?.stdinKnown,
      stdinFile: command?.stdinFile ?? null,
    },
    dir,
    { bodyFlags: [], fileFlags: ['--from'], unknownFlags: [] },
  )
  return { known: read.known, text: read.known ? read.text : null }
}

/** Whether argv[index] holds no expansion; without `known`, whether it has no `$` or backtick. */
export function wordKnown(command, index) {
  const flag = command?.known?.[index]
  if (typeof flag === 'boolean') return flag
  return !/[$`]/.test(String(command?.argv?.[index] ?? ''))
}

/**
 * The long option a key names: itself, or the one option of `names` it is a
 * prefix of, as git's parse-options accepts an unambiguous abbreviation
 * (`--mess` for `--message`). Only the options the rules care about are
 * known here, so an abbreviation git would find ambiguous may still be read
 * as one of them: that errs on the side that reads more.
 */
function longName(key, names) {
  if (names.includes(key)) return key
  if (key.length < 3) return null
  const hits = names.filter((name) => name.startsWith(key))
  return hits.length === 1 ? hits[0] : null
}

/**
 * A git subcommand's options and operands, as parse-options reads them:
 * - short options cluster (`-am msg` is `-a -m msg`); a letter of `short`
 *   takes the rest of the word or the next word as its value, and a letter of
 *   `optional` takes only the rest of the word;
 * - a long option of `long` takes `--opt=value` or `--opt value`; any other
 *   long option takes a value only after `=`;
 * - `--` ends the options, and the operands after it are marked.
 * `index` is the argv index that holds the value (or the option itself).
 * @returns {{ options: { name: string, value: string | null, index: number }[], operands: { value: string, index: number, afterDashes: boolean }[] }}
 */
function readGitArgs(
  argv,
  from,
  { short = '', optional = '', long = [], watch = [] },
) {
  const options = []
  const operands = []
  const names = [...long, ...watch]
  for (let k = from; k < argv.length; k += 1) {
    const arg = argv[k]
    if (arg === '--') {
      for (let j = k + 1; j < argv.length; j += 1)
        operands.push({ value: argv[j], index: j, afterDashes: true })
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq < 0 ? arg : arg.slice(0, eq)
      const name = longName(key, names) ?? key
      if (eq >= 0) options.push({ name, value: arg.slice(eq + 1), index: k })
      else if (long.includes(name)) {
        options.push({ name, value: argv[k + 1] ?? null, index: k + 1 })
        k += 1
      } else options.push({ name, value: null, index: k })
      continue
    }
    if (arg.startsWith('-') && arg.length > 1) {
      let consumed = false
      for (let p = 1; p < arg.length; p += 1) {
        const letter = arg[p]
        if (short.includes(letter)) {
          const rest = arg.slice(p + 1)
          if (rest !== '')
            options.push({ name: `-${letter}`, value: rest, index: k })
          else {
            options.push({
              name: `-${letter}`,
              value: argv[k + 1] ?? null,
              index: k + 1,
            })
            consumed = true
          }
          break
        }
        if (optional.includes(letter)) {
          options.push({
            name: `-${letter}`,
            value: arg.slice(p + 1) || null,
            index: k,
          })
          break
        }
        options.push({ name: `-${letter}`, value: null, index: k })
      }
      if (consumed) k += 1
      continue
    }
    operands.push({ value: arg, index: k, afterDashes: false })
  }
  return { options, operands }
}

// ---------------------------------------------------------------------------
// git's own options, and its config

/**
 * git's own options that take a separate value, besides `-C`, `-c` and
 * `--git-dir`, which are read. `--exec-path`, `--list-cmds` and
 * `--super-prefix` take theirs only after `=`.
 */
const valuedGlobals = new Set([
  '--work-tree',
  '--namespace',
  '--attr-source',
  '--config-env',
])

/**
 * The commands git runs as they are, for which it never looks an alias up:
 * its builtins and the commands it ships, as `git --list-cmds=main` lists
 * them, and git-lfs. Any other word in the subcommand's place is looked up
 * as an alias.
 */
const gitCommands = new Set(
  `add am annotate apply archive backfill bisect blame branch bugreport bundle
  cat-file check-attr check-ignore check-mailmap check-ref-format checkout
  checkout-index cherry cherry-pick citool clean clone column commit
  commit-graph commit-tree config count-objects credential credential-cache
  credential-store daemon describe diagnose diff diff-files diff-index
  diff-pairs diff-tree difftool fast-export fast-import fetch fetch-pack
  filter-branch fmt-merge-msg for-each-ref for-each-repo format-patch fsck
  fsck-objects gc get-tar-commit-id grep gui hash-object help hook
  http-backend index-pack init init-db instaweb interpret-trailers lfs log
  ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base
  merge-file merge-index merge-tree mergetool mktag mktree multi-pack-index mv
  name-rev notes p4 pack-objects pack-redundant pack-refs patch-id prune
  prune-packed pull push range-diff read-tree rebase receive-pack reflog refs
  remote repack replace replay request-pull rerere reset restore rev-list
  rev-parse revert rm send-email send-pack shortlog show show-branch
  show-index show-ref sparse-checkout stage stash status stripspace submodule
  subtree switch symbolic-ref tag unpack-file unpack-objects update-index
  update-ref update-server-info upload-archive upload-pack var verify-commit
  verify-pack verify-tag version whatchanged worktree write-tree`.split(/\s+/),
)

/**
 * A config key as git compares it: the section and the variable name folded,
 * the subsection (`branch.<name>.merge`) as it is.
 */
function canonicalKey(key) {
  const first = key.indexOf('.')
  const last = key.lastIndexOf('.')
  if (first < 0) return key.toLowerCase()
  return `${key.slice(0, first).toLowerCase()}${key.slice(first, last)}${key.slice(last).toLowerCase()}`
}

/** Keys whose value decides what a push or an alias does. */
const decisiveKey = /^(?:alias|push|remote|branch|url)\./i

/** The key of a `key=value` pair, and whether it holds no expansion. */
function keyOf(pair) {
  const eq = pair.indexOf('=')
  const key = eq < 0 ? pair : pair.slice(0, eq)
  return { key: canonicalKey(key), known: !/[$`]/.test(key) }
}

/**
 * git's own options before the subcommand:
 * - `-C <dir>` moves the directory, each one relative to the last;
 * - `-c k=v` and `--config-env` set config for this command only, and are
 *   kept to be handed to the hook's own git reads;
 * - `--git-dir` (else GIT_DIR from the command's environment) names the
 *   repository, relative to the directory;
 * - the other options that take a separate value are skipped with it.
 * `lineConfig` is what earlier commands of the line set with `git config`,
 * set before the command's own `-c` so these still win, as they do in git.
 */
function globalsOf(command, cwd, env, lineConfig = []) {
  const argv = command.argv.map(String)
  const g = {
    argv,
    dir: cwd,
    dirKnown: true,
    gitDir: null,
    gitDirKnown: true,
    workTree: false,
    config: [],
    configArgs: [],
    configKnown: true,
    at: argv.length,
  }
  for (const entry of lineConfig) {
    g.config.push(entry)
    if (entry.known) g.configArgs.push('-c', entry.pair)
    else if (!keyOf(entry.pair).known || decisiveKey.test(entry.pair))
      g.configKnown = false
  }
  let gitDirRaw = null
  let k = 1
  while (k < argv.length) {
    const arg = argv[k]
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1
    const name = eq > 0 ? arg.slice(0, eq) : arg
    const valued =
      arg === '-C' ||
      arg === '-c' ||
      name === '--git-dir' ||
      valuedGlobals.has(name)
    if (!valued) {
      if (!arg.startsWith('-')) break
      k += 1
      continue
    }
    const index = eq > 0 ? k : k + 1
    const value = eq > 0 ? arg.slice(eq + 1) : (argv[k + 1] ?? null)
    k = index + 1
    if (value === null) break
    const known = wordKnown(command, index)
    if (arg === '-C') {
      if (!known) g.dirKnown = false
      g.dir = path.resolve(g.dir, value)
    } else if (arg === '-c' || name === '--config-env') {
      // `--config-env=key=VAR` takes the value from the environment.
      const eqAt = value.indexOf('=')
      const fromEnv = name === '--config-env' && eqAt > 0
      const envValue = fromEnv ? env[value.slice(eqAt + 1)] : undefined
      const entry = fromEnv
        ? {
            pair: `${value.slice(0, eqAt)}=${envValue ?? ''}`,
            known: known && typeof envValue === 'string',
          }
        : { pair: value, known }
      g.config.push(entry)
      if (entry.known) g.configArgs.push('-c', entry.pair)
      else if (!keyOf(entry.pair).known || decisiveKey.test(entry.pair))
        g.configKnown = false
    } else if (name === '--git-dir') {
      gitDirRaw = value
      g.gitDirKnown = known
    } else if (name === '--work-tree') g.workTree = true
  }
  g.at = k
  if (gitDirRaw === null && typeof env.GIT_DIR === 'string' && env.GIT_DIR) {
    gitDirRaw = env.GIT_DIR
    g.gitDirKnown = !/[$`]/.test(env.GIT_DIR)
  }
  if (gitDirRaw !== null && g.gitDirKnown)
    g.gitDir = path.resolve(g.dir, gitDirRaw)
  return g
}

// Variables that would point the hook's own git reads at another repository
// than the one named on their command line (-C, --git-dir).
const discoveryVariables = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
]

/** A git hung on a lock must not hold the tool call; the run's budget bounds it too. */
const gitTimeoutMs = 10_000

/**
 * git, as the command would see its config: in the command's repository,
 * with its `-c` and its environment (GIT_CONFIG_GLOBAL, GIT_CONFIG_COUNT and
 * the rest), through argv, never a shell. It only reads.
 */
function gitRead(g, args, env, { configArgs = g.configArgs } = {}) {
  const clean = { ...env }
  for (const name of discoveryVariables) delete clean[name]
  const step = `ler o git em ${g.dir}`
  const timeout = spawnTimeout(gitTimeoutMs, step)
  const run = spawnSync(
    'git',
    [
      '-C',
      g.dir,
      ...(g.gitDir === null ? [] : ['--git-dir', g.gitDir]),
      ...configArgs,
      ...args,
    ],
    {
      encoding: 'utf8',
      env: { ...clean, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  afterSpawn(run, gitTimeoutMs, timeout, step)
  if (run.error) return { status: null, out: '' }
  return { status: run.status, out: run.stdout ?? '' }
}

/** The command's whole config, as git reads it, or { known: false }. */
function configOf(g, env) {
  if (!g.configKnown) return { known: false }
  const run = gitRead(g, ['config', '--list', '-z'], env)
  if (run.status !== 0) return { known: false }
  const entries = run.out
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const nl = entry.indexOf('\n')
      return nl < 0
        ? [entry, 'true']
        : [entry.slice(0, nl), entry.slice(nl + 1)]
    })
  const all = (key) =>
    entries.filter(([name]) => name === key).map(([, value]) => value)
  return { known: true, all, get: (key) => all(key).at(-1), entries }
}

// ---------------------------------------------------------------------------
// Aliases

const maxAliasDepth = 8

/**
 * The value `alias.<sub>` has for this command: from its own `-c` (the last
 * one wins), else from git's config, which holds what earlier commands of
 * the line set. { known: false } when a `-c` or the config cannot be read;
 * null when there is no such alias. `cache` (ctx.cache, a Map) keeps the
 * config's answers for the rest of the line.
 */
function aliasOf(sub, g, env, cache) {
  const key = `alias.${sub.toLowerCase()}`
  let found = null
  for (const entry of g.config) {
    const name = keyOf(entry.pair)
    if (name.known && name.key !== key) continue
    if (!entry.known) {
      found = { known: false }
      continue
    }
    const eq = entry.pair.indexOf('=')
    found = { known: true, value: eq < 0 ? '' : entry.pair.slice(eq + 1) }
  }
  if (found !== null) return found
  if (!existsSync(g.dir)) return { known: false }
  const cacheKey = [g.dir, g.gitDir, ...g.configArgs, key].join('\0')
  if (cache?.has(cacheKey)) return cache.get(cacheKey)
  const run = gitRead(g, ['config', '--get', key], env)
  let alias = { known: false }
  if (run.status === 0)
    alias = { known: true, value: run.out.replace(/\n$/, '') }
  else if (run.status === 1) alias = null
  cache?.set(cacheKey, alias)
  return alias
}

/**
 * The command with the alias in the subcommand's place replaced by its
 * words, split as git splits them (quotes, no expansion). null when the
 * value is not one plain git command line.
 */
function expandAlias(command, at, value) {
  const parsed = parseCommand(`git ${value}`)
  if (parsed.unparsable || parsed.commands.length !== 1) return null
  const [inner] = parsed.commands
  if (inner.argv[0] !== 'git') return null
  const argv = command.argv.map(String)
  const known = argv.map((_, index) => wordKnown(command, index))
  return {
    ...command,
    argv: [...argv.slice(0, at), ...inner.argv.slice(1), ...argv.slice(at + 1)],
    known: [
      ...known.slice(0, at),
      ...inner.known.slice(1),
      ...known.slice(at + 1),
    ],
  }
}

/**
 * The command as git runs it: its global options read, and an alias in the
 * subcommand's place expanded, as many times as git would. `stop` says why
 * an alias could not be expanded.
 */
function resolveCommand(command, ctx, env, depth = 0) {
  const g = globalsOf(command, ctx.cwd, env, ctx.lineConfig)
  const sub =
    g.at < g.argv.length && wordKnown(command, g.at) ? g.argv[g.at] : null
  if (sub === null || gitCommands.has(sub))
    return { command, g, sub, alias: null }
  if (depth >= maxAliasDepth)
    return { command, g, sub, alias: { name: sub, stop: 'deep' } }
  const alias = aliasOf(sub, g, env, ctx.cache)
  if (alias === null) return { command, g, sub, alias: null }
  if (!alias.known)
    return { command, g, sub, alias: { name: sub, stop: 'unknown' } }
  if (alias.value.trimStart().startsWith('!'))
    return {
      command,
      g,
      sub,
      alias: { name: sub, value: alias.value, stop: 'shell' },
    }
  const expanded = expandAlias(command, g.at, alias.value)
  if (expanded === null)
    return {
      command,
      g,
      sub,
      alias: { name: sub, value: alias.value, stop: 'unreadable' },
    }
  const inner = resolveCommand(expanded, ctx, env, depth + 1)
  return {
    ...inner,
    via: [{ name: sub, value: alias.value }, ...(inner.via ?? [])],
  }
}

const envOf = (command, ctx) => ({
  ...(ctx.env ?? process.env),
  ...command.env,
})

// ---------------------------------------------------------------------------
// Commits

/** Subcommands that make a commit on the branch checked out. */
const committing = new Set(['commit', 'merge', 'cherry-pick', 'revert', 'am'])
const guarded = new Set([...committing, 'push'])

/**
 * Options with which those subcommands make no commit: they leave an
 * operation in progress and put the branch back. `--continue` and `--skip`
 * go on committing, so they are not here.
 */
const leaving = new Set(['--abort', '--quit'])

const commitOnTrunk = `commit em ${trunk}: trabalhe numa branch da issue`
const pushToTrunk = `push em ${trunk}: a mudança entra por PR`
const headMoved = `um comando anterior da linha muda o HEAD`

const commitSpec = {
  short: 'mFCct',
  optional: 'uS',
  long: [
    '--message',
    '--file',
    '--reuse-message',
    '--reedit-message',
    '--fixup',
    '--squash',
    '--author',
    '--date',
    '--template',
    '--cleanup',
    '--trailer',
    '--pathspec-from-file',
  ],
  // Read as a flag, abbreviations included: with no message of its own, it
  // keeps HEAD's.
  watch: ['--amend'],
}

/**
 * git merge's options, as `git merge -h` lists them: `--into-name` names
 * the branch merged into in the message git writes, so its value is read as
 * part of the message.
 */
const mergeSpec = {
  short: 'msFX',
  optional: 'S',
  long: [
    '--message',
    '--file',
    '--strategy',
    '--strategy-option',
    '--cleanup',
    '--into-name',
  ],
}

/**
 * The subcommands whose message the command line carries: how each reads
 * its options, and how the refusal names the message.
 */
const messages = {
  commit: { spec: commitSpec, what: 'a mensagem do commit' },
  merge: { spec: mergeSpec, what: 'a mensagem do merge' },
}

/**
 * A `--trailer` as it lands in the message: `key: value`, whether it was
 * written with `:` or with `=`.
 */
function trailerLine(value) {
  const at = value.search(/[=:]/)
  return at < 0
    ? value
    : `${value.slice(0, at).trim()}: ${value.slice(at + 1).trim()}`
}

/** The options whose value lands in the message git writes. */
const messageParts = new Set([
  '-m',
  '--message',
  '--into-name',
  '--trailer',
  '-F',
  '--file',
])

/**
 * A commit message carrying a skip string, for `commit` and `merge`, which
 * both write a commit (Copilot review of #26: merge was left out). The
 * message is every `-m` and `--message` (git joins them as paragraphs),
 * every `-F`/`--file`, read relative to the command's directory, `-` being
 * stdin, every `--trailer` (commit) and `--into-name` (merge, whose name git
 * writes into the message). A part the hook cannot read (an expansion, a
 * file that is not there, a stdin that is a pipe) asks, critical: it may
 * hold a skip string (Copilot review of #26, third round). The forms a
 * session writes stay readable: a literal `-m`, `-F -` with a heredoc,
 * `-m "$(cat <<'EOF' … EOF)"` and a variable the line assigned. The editor
 * is editorDecision's. The subjects `--log` pulls in are not read: a
 * documented limit.
 */
function commitMessage(command, argv, dir, from, files, { spec, what }) {
  const { options } = readGitArgs(argv, from, spec)
  const unknown = []
  for (const option of options) {
    if (!messageParts.has(option.name) || option.value === null) continue
    let read = { known: wordKnown(command, option.index), text: option.value }
    if (!read.known) read = { known: false, text: null }
    else if (option.name === '--trailer')
      read = { known: true, text: trailerLine(option.value) }
    else if (option.name === '-F' || option.name === '--file')
      read = readSource(command, dir, option.value, true, files)
    if (!read.known) {
      unknown.push(option.value)
      continue
    }
    const token = skipTokenIn(read.text)
    if (token !== null)
      return deny(
        `${what} traz "${token}", que faz o GitHub pular os checks do push e do merge: tire-o da mensagem`,
      )
  }
  if (unknown.length > 0)
    return unread(
      `não consegui ler ${what} (${unknown.map((value) => `"${value.length > 60 ? `${value.slice(0, 59)}…` : value}"`).join(', ')}): confira que ali não há um texto que faz o GitHub pular os checks, ou escreva a mensagem no comando (-m "…", -F - com heredoc, -F arquivo)`,
    )
  return pass()
}

// ---------------------------------------------------------------------------
// Messages a commit brings from elsewhere

/**
 * What a read of the hook's own adds so that it runs nothing, whatever the
 * command's config: no lazy fetch from a promisor remote (git fetches an
 * object it lacks through any transport, and ext:: runs a program), and
 * core.fsmonitor off (git runs it when it reads the index, as `:path` does).
 * The variable set here, and a `-c` given after the others, override every
 * other source: the command's own -c, GIT_CONFIG_COUNT or
 * GIT_CONFIG_PARAMETERS in its environment, a config file it points at.
 */
const inertConfig = ['-c', 'core.fsmonitor=false']
const inertEnv = (env) => ({ ...env, GIT_NO_LAZY_FETCH: '1' })

/**
 * The messages of revisions in the command's repository, each as `format`
 * gives it (`%B` the whole message, `%s` the subject), selected the way
 * cherry-pick and revert select them: each revision alone, a range walked
 * (`git log --no-walk` walks once a range or a `^rev` is given). null when
 * git cannot say.
 *
 * Of the command's `-c` (and the line's `git config`), only
 * core.useReplaceRefs is kept: it decides which commit a name points at (a
 * replace ref shows another in its place), and one the hook cannot read makes
 * the messages unknown. The rest is left out: this read must not run what a
 * `-c` asks for, such as a promisor remote it names, from which git fetches a
 * commit it lacks through any transport (`ext::` runs a program), or a
 * gpg.program (`--no-show-signature` too). The environment's config is kept,
 * so what it could run is turned off (inertEnv, inertConfig).
 */
function revMessages(g, revs, format, env) {
  const configArgs = []
  for (const entry of g.config) {
    const key = keyOf(entry.pair)
    if (key.known && key.key !== 'core.usereplacerefs') continue
    if (!entry.known) return null
    configArgs.push('-c', entry.pair)
  }
  const run = gitRead(
    g,
    [
      'log',
      '--no-walk',
      '--no-show-signature',
      `--format=${format}%x00`,
      '--end-of-options',
      ...revs,
      '--',
    ],
    inertEnv(env),
    { configArgs: [...configArgs, ...inertConfig] },
  )
  if (run.status !== 0) return null
  return run.out
    .split('\0')
    .map((text) => text.replace(/^\n/, ''))
    .filter((text) => text.trim() !== '')
}

const copied = {
  'cherry-pick': 'a mensagem que o git cherry-pick copia',
  revert: 'o assunto que o git revert copia',
  am: 'a mensagem do patch que o git am aplica',
  reuse: 'a mensagem que o git commit reaproveita',
  subject: 'o assunto que o git commit copia',
}

/** The refusal for a copied message that carries a skip string, or null. */
function copiedSkip(texts, what, where) {
  for (const text of texts) {
    const token = skipTokenIn(text)
    if (token !== null)
      return deny(
        `${what} (${where}) traz "${token}", que faz o GitHub pular os checks do push e do merge: não traga essa mensagem para a branch`,
      )
  }
  return null
}

const unreadCopy = (what, why) =>
  unread(
    `não consegui ler ${what} (${why}): confira que ali não há um texto que faz o GitHub pular os checks`,
  )

/**
 * The options of cherry-pick and revert, as `git cherry-pick -h` and `git
 * revert -h` list them. Any other option may be one of the revision walk's
 * (`--stdin`, `--all`), which picks commits the hook does not name, so it
 * makes the revisions unknown.
 */
const pickSpec = {
  short: 'mX',
  optional: 'S',
  long: [
    '--mainline',
    '--strategy',
    '--strategy-option',
    '--cleanup',
    '--empty',
  ],
}
const pickFlags = new Set([
  '-n',
  '--no-commit',
  '-e',
  '--edit',
  '--no-edit',
  '-x',
  '-r',
  '-s',
  '--signoff',
  '--no-signoff',
  '--ff',
  '--allow-empty',
  '--allow-empty-message',
  '--keep-redundant-commits',
  '--rerere-autoupdate',
  '--no-rerere-autoupdate',
  '-S',
  '--gpg-sign',
  '--no-gpg-sign',
  '--reference',
  '--no-reference',
  ...pickSpec.long,
  '-m',
  '-X',
])

/**
 * The messages cherry-pick copies whole, and the subjects revert copies
 * (`Revert "<subject>"`), read from the revisions named. Nothing named (a
 * `--continue` of a sequence already judged) reads nothing.
 */
function pickDecision(command, g, sub, env) {
  const what = copied[sub]
  const { options, operands } = readGitArgs(g.argv, g.at + 1, pickSpec)
  if (options.some((option) => leaving.has(option.name))) return pass()
  if (operands.length === 0) return pass()
  const unknownOption = options.find(
    (option) =>
      !pickFlags.has(option.name) &&
      !['--continue', '--skip'].includes(option.name),
  )
  if (unknownOption !== undefined)
    return unreadCopy(what, `a opção ${unknownOption.name} escolhe commits`)
  const blind = operands.find((operand) => !wordKnown(command, operand.index))
  if (blind !== undefined)
    return unreadCopy(what, `a revisão "${blind.value}" não pôde ser lida`)
  const revs = operands.map((operand) =>
    operand.value === '-' ? '@{-1}' : operand.value,
  )
  const texts = revMessages(g, revs, sub === 'revert' ? '%s' : '%B', env)
  if (texts === null) return unreadCopy(what, `o git não leu ${revs.join(' ')}`)
  return copiedSkip(texts, what, revs.join(' ')) ?? pass()
}

/** git am's options that take a value (`-p1`, `--directory dir`). */
const amSpec = {
  short: 'pC',
  optional: 'S',
  long: [
    '--whitespace',
    '--directory',
    '--exclude',
    '--include',
    '--patch-format',
    '--resolvemsg',
    '--quoted-cr',
    '--empty',
  ],
}

/** git am's options with which it applies no new patch. */
const amResumes = new Set([
  '--continue',
  '--skip',
  '--resolved',
  '-r',
  '--show-current-patch',
  '--retry',
])

/** A MIME encoded word (RFC 2047), as git format-patch writes a subject that is not ASCII. */
function decodeWords(text) {
  return text.replace(/=\?[^?]+\?([QqBb])\?([^?]*)\?=/g, (_, kind, data) =>
    kind.toUpperCase() === 'B'
      ? Buffer.from(data, 'base64').toString('latin1')
      : data
          .replaceAll('_', ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (__, hex) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
          ),
  )
}

/**
 * The line that starts a message in a mailbox, as git mailsplit tells it
 * (is_from_line): `From `, then a time and a year, as git format-patch
 * writes `From <sha> Mon Sep 17 00:00:00 2001`.
 */
const fromLine = /^From .*\d:\d\d:\d\d.*\d{4}\s*$/

/**
 * The messages a mailbox holds, as git am reads them: each one's Subject
 * and body up to the patch (a `---` line or the diff), decoded from
 * quoted-printable or base64. null for what the hook does not read: a
 * multipart message, an encoding it does not know.
 */
function mailboxMessages(text, { messageId }) {
  const lines = text.split(/\r?\n/)
  const chunks = []
  let current = []
  for (const line of lines) {
    if (fromLine.test(line) && current.some((l) => l.trim() !== '')) {
      chunks.push(current)
      current = []
    }
    current.push(line)
  }
  chunks.push(current)
  const messages = []
  for (const chunk of chunks) {
    const start = fromLine.test(chunk[0] ?? '') ? 1 : 0
    const blank = chunk.findIndex(
      (line, index) => index >= start && line === '',
    )
    const headerLines = chunk.slice(start, blank < 0 ? chunk.length : blank)
    const headers = new Map()
    let last = null
    for (const line of headerLines) {
      if (/^[ \t]/.test(line) && last !== null)
        headers.set(last, `${headers.get(last)} ${line.trim()}`)
      else {
        const at = line.indexOf(':')
        if (at <= 0) continue
        last = line.slice(0, at).trim().toLowerCase()
        headers.set(last, line.slice(at + 1).trim())
      }
    }
    if (/^multipart\//i.test(headers.get('content-type') ?? '')) return null
    const encoding = (headers.get('content-transfer-encoding') ?? '')
      .trim()
      .toLowerCase()
    // Decoded whole first: the line that ends the message is inside the
    // encoding too.
    let raw = (blank < 0 ? [] : chunk.slice(blank + 1)).join('\n')
    if (encoding === 'base64')
      raw = Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('latin1')
    else if (encoding === 'quoted-printable')
      raw = raw
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        )
    else if (!['', '7bit', '8bit', 'binary'].includes(encoding)) return null
    const bodyLines = []
    for (const line of raw.split(/\r?\n/)) {
      if (line === '---' || /^diff --git |^Index: |^--- \S/.test(line)) break
      bodyLines.push(line)
    }
    const body = bodyLines.join('\n')
    const subject = decodeWords(headers.get('subject') ?? '')
    const id = messageId
      ? `\n\nMessage-ID: ${headers.get('message-id') ?? ''}`
      : ''
    if (subject === '' && body.trim() === '') continue
    messages.push(`${subject}\n\n${body}${id}`)
  }
  return messages
}

/**
 * The messages of the patches git am applies: each mailbox file named, read
 * relative to the directory git runs in, or stdin when none is named (a
 * heredoc, a `<` file; a pipe is not read).
 */
function amDecision(command, g, files) {
  const what = copied.am
  const { options, operands } = readGitArgs(g.argv, g.at + 1, amSpec)
  if (
    options.some(
      (option) => leaving.has(option.name) || amResumes.has(option.name),
    )
  )
    return pass()
  const messageId = options.some((option) =>
    ['-m', '--message-id'].includes(option.name),
  )
  const sources =
    operands.length === 0
      ? [{ value: '-', index: -1, known: true }]
      : operands.map((operand) => ({
          ...operand,
          known: wordKnown(command, operand.index),
        }))
  const decisions = []
  for (const source of sources) {
    const where = source.value === '-' ? 'o stdin' : source.value
    const read = readSource(command, g.dir, source.value, source.known, files)
    if (!read.known) {
      decisions.push(unreadCopy(what, `${where} não pôde ser lido`))
      continue
    }
    const messages = mailboxMessages(read.text, { messageId })
    if (messages === null) {
      decisions.push(
        unreadCopy(what, `${where} traz uma codificação que o hook não lê`),
      )
      continue
    }
    const refusal = copiedSkip(messages, what, where)
    if (refusal !== null) return refusal
  }
  return combine(decisions)
}

/**
 * The messages git commit copies from a commit: `-C`/`--reuse-message` and
 * `-c`/`--reedit-message` take its whole message, `--fixup` and `--squash`
 * its subject (`fixup! <subject>`), `--fixup=amend:` and `reword:` the whole
 * message, and `--amend` with no message of its own keeps HEAD's. The
 * editor, which may change any of them, is editorDecision's.
 */
function commitSources(command, g, env) {
  const { options } = readGitArgs(g.argv, g.at + 1, commitSpec)
  const reads = []
  let ownMessage = false
  let amend = false
  for (const option of options) {
    if (['-m', '--message', '-F', '--file'].includes(option.name))
      ownMessage = true
    if (option.name === '--amend') amend = true
    if (option.value === null) continue
    if (
      ['-C', '--reuse-message', '-c', '--reedit-message'].includes(option.name)
    ) {
      ownMessage = true
      reads.push({
        option,
        rev: option.value,
        format: '%B',
        what: copied.reuse,
      })
    } else if (option.name === '--fixup' || option.name === '--squash') {
      const whole = /^(?:amend|reword):/.exec(option.value)
      reads.push({
        option,
        rev: whole ? option.value.slice(whole[0].length) : option.value,
        format: whole ? '%B' : '%s',
        what: whole ? copied.reuse : copied.subject,
      })
    }
  }
  if (amend && !ownMessage)
    reads.push({ option: null, rev: 'HEAD', format: '%B', what: copied.reuse })
  const decisions = []
  for (const { option, rev, format, what } of reads) {
    if (option !== null && !wordKnown(command, option.index)) {
      decisions.push(unreadCopy(what, `a revisão "${rev}" não pôde ser lida`))
      continue
    }
    const texts = revMessages(g, [rev], format, env)
    if (texts === null) {
      decisions.push(unreadCopy(what, `o git não leu ${rev}`))
      continue
    }
    const refusal = copiedSkip(texts, what, rev)
    if (refusal !== null) return refusal
  }
  return combine(decisions)
}

/**
 * A commit whose message comes from elsewhere carrying a skip string
 * (Copilot review of #26): cherry-pick and revert copy it from the commits
 * they name, am from the patch, and git commit from a commit it names. Like
 * a message on the line, one that cannot be read asks, critical (third
 * round): the source is a commit or a file the line names, and asking costs
 * only the rare line that names it through an expansion.
 */
function copiedMessage(command, g, sub, env, files) {
  if (sub === 'cherry-pick' || sub === 'revert')
    return pickDecision(command, g, sub, env)
  if (sub === 'am') return amDecision(command, g, files)
  if (sub === 'commit') return commitSources(command, g, env)
  return pass()
}

/** Editors that leave the message as git prepared it. */
const noopEditors = new Set(['true', ':'])

/**
 * Whether the editor git would run writes nothing: GIT_EDITOR, or else the
 * command's own `-c core.editor`, is `true` or `:`. Any other editor (the
 * config's, VISUAL, EDITOR, vi) may write anything.
 */
function editorWritesNothing(g, env) {
  const named =
    typeof env.GIT_EDITOR === 'string'
      ? { value: env.GIT_EDITOR, known: true }
      : g.config
          .filter((entry) => keyOf(entry.pair).key === 'core.editor')
          .map((entry) => ({
            value: entry.pair.slice(entry.pair.indexOf('=') + 1),
            known: entry.known && entry.pair.includes('='),
          }))
          .at(-1)
  return (
    named !== undefined &&
    named.known &&
    !/[$`]/.test(named.value) &&
    noopEditors.has(named.value.trim())
  )
}

/** The editor flags of each subcommand, the last one winning. */
const editorSpecs = {
  commit: {
    ...commitSpec,
    watch: [...commitSpec.watch, '--edit', '--no-edit'],
  },
  merge: { ...mergeSpec, watch: ['--edit', '--no-edit'] },
  'cherry-pick': pickSpec,
  revert: pickSpec,
}

/**
 * Whether git opens an editor for the message of the commit it makes, as
 * git 2.50 does with no terminal (the hook's commands have none). git
 * commit opens one unless the line gives the message (-m, -F, -C), a plain
 * --fixup or --no-edit, and always with -e, -c (--reedit-message) and a
 * `--fixup=amend:` or `reword:`; --squash and -t alone open one. git merge
 * opens one only with -e, GIT_MERGE_AUTOEDIT=yes or --continue (which runs
 * git commit); cherry-pick and revert only with -e.
 */
function opensEditor(g, sub, env) {
  const spec = editorSpecs[sub]
  if (spec === undefined) return false
  const { options } = readGitArgs(g.argv, g.at + 1, spec)
  const names = options.map((option) => option.name)
  if (names.some((name) => leaving.has(name))) return false
  const flag = names
    .filter((name) => ['-e', '--edit', '--no-edit'].includes(name))
    .at(-1)
  if (flag !== undefined) return flag !== '--no-edit'
  if (sub === 'merge')
    return (
      names.includes('--continue') ||
      String(env.GIT_MERGE_AUTOEDIT ?? '').toLowerCase() === 'yes'
    )
  if (sub !== 'commit') return false
  if (names.some((name) => ['-c', '--reedit-message'].includes(name)))
    return true
  // A plain --fixup writes `fixup! <subject>` with no editor.
  const fixup = options.filter((option) => option.name === '--fixup').at(-1)
  if (fixup !== undefined)
    return /^(?:amend|reword):/.test(String(fixup.value ?? ''))
  return !names.some((name) =>
    ['-m', '--message', '-F', '--file', '-C', '--reuse-message'].includes(name),
  )
}

/**
 * The message an editor writes (Copilot review of #26, third round: gh pr
 * create --editor asks, critical, and so does this): it may carry a skip
 * string, and the hook cannot read it. An editor that writes nothing
 * (GIT_EDITOR=true) leaves the message the other rules read.
 */
function editorDecision(g, sub, env) {
  if (!opensEditor(g, sub, env) || editorWritesNothing(g, env)) return pass()
  return unread(
    `o git ${sub} abre um editor para a mensagem, e o hook não lê o que ele escreve: confira que ali não há um texto que faz o GitHub pular os checks, ou dê a mensagem no comando (-m "…", -F - com heredoc, --no-edit) ou rode com GIT_EDITOR=true`,
  )
}

// ---------------------------------------------------------------------------
// Pushes

const pushSpec = {
  short: 'o',
  long: ['--repo', '--receive-pack', '--exec', '--push-option'],
  watch: ['--all', '--branches', '--mirror', '--delete'],
}

const trunkRefs = new Set([trunk, `heads/${trunk}`, `refs/heads/${trunk}`])

/**
 * Whether a push destination can be main: main itself in any of the forms
 * git resolves to it, the remote's HEAD (which is main), or a pattern. With
 * `fold`, case is folded: a push to a repository on disk (`git push .
 * HEAD:MAIN`) lands on a filesystem that may not tell MAIN from main (see
 * isTrunkRef). GitHub tells them apart, so over the network MAIN is another
 * branch and the case counts (verification of the sixth round of Copilot's
 * review of #26).
 */
const reachesTrunk = (ref, fold = false) =>
  trunkRefs.has(fold ? ref.toLowerCase() : ref) ||
  ref === 'HEAD' ||
  ref.includes('*')

/**
 * Where a refspec pushes to: after the last `:`, or the source itself when
 * there is none, HEAD and @ being the branch checked out (`viaHead`). A
 * leading `+` only forces. `matching` for `:`, which pushes every branch
 * that has one of the same name on the remote, main among them.
 */
function destinationOf(refspec, branch) {
  const spec = refspec.replace(/^\+/, '')
  if (spec === ':') return { matching: true }
  const colon = spec.lastIndexOf(':')
  const target = colon < 0 ? spec : spec.slice(colon + 1)
  const source = colon < 0 ? spec : spec.slice(0, colon)
  const named = target === '' ? source : target
  if (colon < 0 && (named === 'HEAD' || named === '@'))
    return { target: branch, viaHead: true }
  return { target: named, viaHead: false }
}

/**
 * A refspec of a push. `fold` when the remote may be a repository on disk,
 * where MAIN can be main (reachesTrunk).
 */
function refspecDecision(
  value,
  known,
  repo,
  deleting,
  { where = '', fold = false } = {},
) {
  if (!known)
    return unread(
      `não consegui ler o destino do push em "${value}": confira que não é ${trunk}`,
    )
  if (deleting)
    return reachesTrunk(value.replace(/^\+/, ''), fold)
      ? deny(`${pushToTrunk} (--delete apaga ${trunk})`)
      : pass()
  const destination = destinationOf(value, repo.branch)
  if (destination.matching)
    return deny(
      `${pushToTrunk} (o refspec "${value}"${where} empurra as branches de mesmo nome, ${trunk} junto)`,
    )
  if (destination.viaHead && repo.branchKnown === false)
    return unread(
      `não consegui saber qual branch o refspec "${value}" empurra: ${headMoved}; confira que não é ${trunk}`,
    )
  if (destination.target !== null && reachesTrunk(destination.target, fold))
    return deny(
      `${pushToTrunk} (o refspec "${value}"${where} chega a ${trunk})`,
    )
  return pass()
}

/**
 * The repository on disk a URL names, a path or a file:// URL (git's rule:
 * no scheme, and no `:` before the first `/`), as repoAt reads it: `git
 * push . HEAD:main` writes this repository's own main (Copilot review of
 * #26, sixth round). null for a URL of the network, or a path that holds
 * no repository; { repo: null, unknown: true } when git could not say.
 */
function localRepo(url, g, repoAt) {
  if (typeof repoAt !== 'function') return null
  let where = null
  if (/^file:\/\//i.test(url)) where = url.replace(/^file:\/\//i, '')
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^[^/]*:/.test(url))
    where = url
  if (where === null) return null
  const dir = path.resolve(g.dir, where)
  if (!existsSync(dir)) return null
  try {
    return repoAt(dir)
  } catch {
    return { repo: null, unknown: true }
  }
}

/**
 * The repositories a remote pushes to: its push URLs, as `git remote
 * get-url --push` gives them, or, for a word that names no remote, the URL
 * itself after git's insteadOf rewriting. A URL on disk is the repository
 * there, and `local` says one of them is this project on disk.
 */
function remoteTarget(g, name, env, repoAt) {
  if (name.startsWith('-')) return { known: false }
  const named = gitRead(g, ['remote', 'get-url', '--push', '--all', name], env)
  let urls = null
  if (named.status === 0) urls = named.out.split('\n').filter(Boolean)
  else if (named.status === 2) {
    const url = gitRead(g, ['ls-remote', '--get-url', name], env)
    if (url.status === 0) urls = url.out.split('\n').filter(Boolean)
  }
  if (urls === null) return { known: false }
  const local = urls.map((url) => localRepo(url, g, repoAt))
  if (local.some((found) => found?.unknown === true)) return { known: false }
  return {
    known: true,
    project: urls.some(
      (url, index) => isProject(repoFromRemote(url)) || isProject(local[index]),
    ),
    local: local.some((found) => isProject(found)),
  }
}

/** The remote a push with none named goes to, as git picks it. */
function defaultRemote(config, branch) {
  return (
    (branch ? config.get(`branch.${branch}.pushremote`) : undefined) ??
    config.get('remote.pushdefault') ??
    (branch ? config.get(`branch.${branch}.remote`) : undefined) ??
    'origin'
  )
}

const isTrue = (value) =>
  ['true', 'yes', 'on', '1'].includes(String(value ?? '').toLowerCase())

/**
 * A push, judged as git reads it and, with `--repo`, as a reader could take
 * it (Copilot review of #26, third round). git takes the first operand as
 * the repository even when `--repo` names one, and the rest as refspecs
 * (measured on git 2.50: `git push --repo <url> HEAD:main` pushes to a
 * remote named `HEAD:main`, and fails). A reader takes `--repo` as the
 * repository and every operand as a refspec. Both readings are judged and
 * the worst wins: the first is what runs, and the second is what the line
 * says, so neither can let a push to main through.
 */
function pushDecision(command, g, repo, env, repoAt) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, pushSpec)
  let config = null
  const readConfig = () => {
    config ??= configOf(g, env)
    return config
  }
  const repoOption = options.filter((option) => option.name === '--repo').at(-1)
  const named =
    repoOption?.value != null
      ? { value: repoOption.value, index: repoOption.index }
      : undefined
  const readings = [
    operands.length > 0
      ? { remoteWord: operands[0], refspecs: operands.slice(1) }
      : { remoteWord: named, refspecs: [] },
  ]
  if (named !== undefined && operands.length > 0)
    readings.push({ remoteWord: named, refspecs: operands })
  return combine(
    readings.map((reading) =>
      pushReading(command, g, repo, env, options, reading, readConfig, repoAt),
    ),
  )
}

function pushReading(
  command,
  g,
  repo,
  env,
  options,
  { remoteWord, refspecs },
  readConfig,
  repoAt,
) {
  const has = (name) => options.some((option) => option.name === name)

  // Where the push lands: the remote (or URL) named, or the remote git
  // picks. A remote that cannot be read may be this project.
  let remote = null
  let target = { known: false }
  if (remoteWord !== undefined) {
    if (wordKnown(command, remoteWord.index)) {
      remote = remoteWord.value
      target = remoteTarget(g, remote, env, repoAt)
    }
  } else {
    const read = readConfig()
    if (read.known) {
      remote = defaultRemote(read, repo.branch)
      target = remoteTarget(g, remote, env, repoAt)
    }
  }
  if (target.known && !target.project) return pass()
  // A remote that cannot be read may be this repository on disk.
  const fold = !target.known || target.local === true

  if (has('--all') || has('--branches'))
    return deny(
      `${pushToTrunk} (${has('--all') ? '--all' : '--branches'} empurra ${trunk} junto)`,
    )
  if (has('--mirror'))
    return deny(`${pushToTrunk} (--mirror empurra ${trunk} junto)`)
  const deleting = has('--delete') || has('-d')

  if (refspecs.length > 0)
    return combine(
      refspecs.map((refspec) =>
        refspecDecision(
          refspec.value,
          wordKnown(command, refspec.index),
          repo,
          deleting,
          { fold },
        ),
      ),
    )

  // No refspec: git's config decides what goes, and where.
  const read = readConfig()
  if (!read.known)
    return unread(
      `não consegui ler a configuração que decide o destino do push: confira que ele não vai para ${trunk}`,
    )
  if (remote !== null && isTrue(read.get(`remote.${remote}.mirror`)))
    return deny(
      `${pushToTrunk} (o remote ${remote} é um mirror e empurra ${trunk} junto)`,
    )
  const configured = remote === null ? [] : read.all(`remote.${remote}.push`)
  if (configured.length > 0)
    return combine(
      configured.map((refspec) =>
        refspecDecision(refspec, true, repo, deleting, {
          where: ` de remote.${remote}.push`,
          fold,
        }),
      ),
    )
  if (repo.branchKnown === false)
    return unread(
      `não consegui saber qual branch o push leva: ${headMoved}; confira que não é ${trunk}`,
    )
  if (repo.branch === trunk)
    return deny(
      `${pushToTrunk} (sem refspec, o push leva a branch atual, ${trunk})`,
    )
  const mode = String(read.get('push.default') ?? 'simple').toLowerCase()
  if (mode === 'matching')
    return deny(
      `${pushToTrunk} (push.default=matching empurra as branches de mesmo nome, ${trunk} junto)`,
    )
  if (mode === 'upstream' || mode === 'tracking') {
    const merge =
      repo.branch === null ? undefined : read.get(`branch.${repo.branch}.merge`)
    return merge !== undefined && reachesTrunk(merge, fold)
      ? deny(
          `${pushToTrunk} (push.default=${mode} leva a branch ao upstream dela, ${trunk})`,
        )
      : pass()
  }
  if (['simple', 'current', 'nothing'].includes(mode)) return pass()
  return unread(
    `push.default=${mode} não é um modo que o hook conheça: confira que o push não vai para ${trunk}`,
  )
}

// ---------------------------------------------------------------------------
// Writes to the worktree (Copilot review of #26, fourth round)
//
// build-guard judges every file an Edit or a Write touches, and git writes
// files too: `git checkout -- README.md` puts back a file, `git merge` brings
// a branch's files, `git apply` a patch's. So a git command that writes
// tracked files in the worktree, or the index they are committed from, gets
// the decision an edit of the same files gets (edit-gate.mjs): on main it is
// refused, with a plan of this session not yet posted it asks, and with the
// gate not open for the branch it is refused, unless every path it names is
// in context/intent/.
//
// What the loop needs before the gate opens stays out: cutting or switching
// a branch with no path (`git switch -c X origin/main`, `git checkout X`),
// fetching, reading, `git stash` (push, list, show, drop), `git worktree
// add`, the dry runs, a `git merge --ff-only` to main (it lands where a
// switch to main would), and the `--abort`/`--quit` that put a stopped
// merge, rebase, cherry-pick, revert or am back where it started. So do `git add`
// and `git commit`, which record what the worktree already holds, and `git
// reset --soft`/`--mixed` with no path, which move the branch and the index
// but write no file.
//
// A write that names no path (a merge, a pull, a stash pop) is judged as the
// worktree whole, not file by file: the files a commit or a patch brings are
// not read, so the harness paths among them do not ask on their own. A path
// or a directory the hook cannot read makes the decision uncertain: what
// would be refused asks, critical, instead (third round).

/**
 * Options that take a value, per subcommand that may write, as readGitArgs
 * reads them; any other option is a flag, or takes its value after `=`.
 */
const writeSpecs = {
  checkout: {
    short: 'bB',
    long: ['--orphan', '--conflict', '--pathspec-from-file'],
  },
  restore: {
    short: 's',
    long: ['--source', '--conflict', '--pathspec-from-file'],
  },
  reset: { long: ['--pathspec-from-file'] },
  rm: { long: ['--pathspec-from-file'] },
  mv: {},
  clean: { short: 'e', long: ['--exclude'] },
  apply: {
    short: 'pC',
    long: [
      '--exclude',
      '--include',
      '--whitespace',
      '--directory',
      '--build-fake-ancestor',
    ],
  },
  'checkout-index': { long: ['--prefix', '--stage'] },
  mergetool: { short: 'tO', long: ['--tool'] },
  'merge-file': { short: 'L', long: ['--diff-algorithm', '--marker-size'] },
}

/** Subcommands that write the worktree or the index whole, but for the options that leave. */
const wholeWrites = {
  am: ['--abort', '--quit', '--show-current-patch'],
  'cherry-pick': ['--abort', '--quit'],
  revert: ['--abort', '--quit'],
  merge: ['--abort', '--quit'],
  pull: ['--dry-run'],
  rebase: ['--abort', '--quit', '--edit-todo', '--show-current-patch'],
  'read-tree': ['-n', '--dry-run'],
  'filter-branch': [],
}

/** Every subcommand this section judges, for a word read after one git does not know. */
const writers = new Set([
  ...Object.keys(writeSpecs),
  ...Object.keys(wholeWrites),
  'stash',
  'update-index',
  'sparse-checkout',
  'lfs',
])

/** main as a merge names it: the branch, or origin's copy of it. */
const trunkNames = new Set([
  ...trunkRefs,
  `origin/${trunk}`,
  `remotes/origin/${trunk}`,
  `refs/remotes/origin/${trunk}`,
])

/**
 * `git merge --ff-only <main>`: the branch moves to main's commit, or git
 * refuses, so the worktree ends as main has it, with nothing of any other
 * branch. That is where `git switch -C <branch> origin/main`, which the loop
 * needs before the gate opens, would leave it too, so it is no build; a
 * branch being brought up to date for its plan does it (Copilot review of
 * #26, fourth round, measured on the corpus of real commands).
 */
function fastForwardToTrunk(command, g) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, mergeSpec)
  return (
    options.some((entry) => entry.name === '--ff-only') &&
    !options.some((entry) => ['--no-ff', '--ff'].includes(entry.name)) &&
    operands.length === 1 &&
    wordKnown(command, operands[0].index) &&
    trunkNames.has(operands[0].value)
  )
}

/** The options with which git apply only reads the patch, unless --apply is also given. */
const applyReads = new Set(['--check', '--stat', '--numstat', '--summary'])

/** The update-index options that only refresh what the index knows of the disk. */
const refreshOnly = new Set([
  '-q',
  '--refresh',
  '--really-refresh',
  '--ignore-missing',
  '--unmerged',
  '--ignore-submodules',
  '--verbose',
])

/**
 * A path a write names: { value, known }. `null` in place of the list is
 * the worktree whole.
 * @typedef {{ value: string, known: boolean }} Pathspec
 * @typedef {{ paths: Pathspec[] | null, unsure: string[] }} Write
 */

const wholeTree = () => ({ paths: null, unsure: [] })

const pathsOf = (command, operands) =>
  operands.map((operand) => ({
    value: operand.value,
    known: wordKnown(command, operand.index),
  }))

/**
 * The paths `--pathspec-from-file` lists: one per line, or NUL-separated
 * with --pathspec-file-nul, `-` being stdin. A list the hook cannot read,
 * or a C-quoted line it would have to unquote, is unsure.
 * @returns {{ paths: Pathspec[], unsure: string | null } | null}
 */
function pathspecFile(command, dir, options, files) {
  const option = options
    .filter((entry) => entry.name === '--pathspec-from-file')
    .at(-1)
  if (option === undefined || option.value === null) return null
  const where = `a lista de caminhos de --pathspec-from-file (${option.value})`
  const read = readSource(
    command,
    dir,
    option.value,
    wordKnown(command, option.index),
    files,
  )
  if (!read.known) return { paths: [], unsure: where }
  const nul = options.some((entry) => entry.name === '--pathspec-file-nul')
  const lines = read.text
    .split(nul ? '\0' : /\r?\n/)
    .filter((line) => line !== '')
  if (!nul && lines.some((line) => line.startsWith('"')))
    return { paths: [], unsure: where }
  return {
    paths: lines.map((value) => ({ value, known: true })),
    unsure: null,
  }
}

/**
 * Whether `word` names an object of `kind` (commit, tree) in the command's
 * repository: true, false, or null when git cannot say. None of the
 * command's `-c` is kept, and what its environment's config could run is
 * turned off: a promisor remote it names would make the read fetch, and the
 * ext:: transport runs a program; `:path` reads the index, which runs
 * core.fsmonitor.
 */
function namesObject(g, word, kind, env) {
  const run = gitRead(
    g,
    [
      'rev-parse',
      '--verify',
      '--quiet',
      '--end-of-options',
      `${word}^{${kind}}`,
    ],
    inertEnv(env),
    { configArgs: inertConfig },
  )
  if (run.status === 0) return true
  if (run.status === 1) return false
  return null
}

/**
 * Whether `git checkout <word>` would create a branch from a remote one
 * of that name (git's guess): refs/remotes/<remote>/<word> exists for a
 * remote the repository has. null when git cannot say.
 */
function guessedBranch(g, word, env) {
  const remotes = gitRead(g, ['remote'], env, { configArgs: [] })
  const refs = gitRead(
    g,
    ['for-each-ref', '--format=%(refname)', 'refs/remotes/'],
    env,
    { configArgs: [] },
  )
  if (remotes.status !== 0 || refs.status !== 0) return null
  const names = new Set(refs.out.split('\n').filter(Boolean))
  return remotes.out
    .split('\n')
    .filter(Boolean)
    .some((remote) => names.has(`refs/remotes/${remote}/${word}`))
}

/**
 * The operands of a command that takes `[<tree-ish>] [--] <pathspec>…`
 * (checkout, reset), split as git splits them: after `--`, every word is a
 * path and the one before is the tree-ish; with no `--`, the first word is
 * the tree-ish when it names one (`kind`), and a path otherwise. A first
 * word git cannot place is taken as both: its paths are unsure.
 * @returns {{ treeish: object | null, paths: Pathspec[], unsure: string[] }}
 */
function splitTreeish(command, g, operands, env, kind, read) {
  const after = operands.filter((operand) => operand.afterDashes)
  const before = operands.filter((operand) => !operand.afterDashes)
  if (operands.length > before.length)
    return {
      treeish: before[0] ?? null,
      paths: pathsOf(command, [...before.slice(1), ...after]),
      unsure: [],
    }
  if (before.length === 0) return { treeish: null, paths: [], unsure: [] }
  const [first, ...rest] = before
  const known = wordKnown(command, first.index)
  const named = known && read ? namesObject(g, first.value, kind, env) : null
  if (named === true)
    return { treeish: first, paths: pathsOf(command, rest), unsure: [] }
  if (named === false)
    return { treeish: null, paths: pathsOf(command, before), unsure: [] }
  return {
    treeish: first,
    paths: pathsOf(command, before),
    unsure: [`se "${first.value}" é uma revisão ou um caminho`],
  }
}

/**
 * git checkout: a write when it names paths (after `--`, after a tree-ish,
 * or a word that is no branch nor commit), with -p, or with -f or -m and no
 * branch (they put back every file); a branch switch otherwise.
 */
function checkoutWrite(command, g, env, files, read) {
  const { options, operands } = readGitArgs(
    g.argv,
    g.at + 1,
    writeSpecs.checkout,
  )
  const has = (...names) => options.some((entry) => names.includes(entry.name))
  if (has('-b', '-B', '--orphan', '-d', '--detach')) return null
  const patch = has('-p', '--patch')
  const listed = pathspecFile(command, g.dir, options, files)
  if (listed !== null)
    return { paths: listed.paths, unsure: listed.unsure ? [listed.unsure] : [] }
  const dashed = operands.some((operand) => operand.afterDashes)
  const before = operands.filter((operand) => !operand.afterDashes)
  if (before.length === 0 && !dashed)
    return patch || has('-f', '--force', '-m', '--merge') ? wholeTree() : null
  if (!dashed && before.length === 1 && !patch) {
    // `git checkout <word>`: a branch or a commit switches (`-` is the
    // previous one); a remote branch of that name makes one; anything else
    // is a path.
    const [word] = before
    if (word.value === '-' && wordKnown(command, word.index)) return null
    if (!wordKnown(command, word.index) || !read)
      return {
        paths: pathsOf(command, before),
        unsure: [`se "${word.value}" é uma branch ou um caminho`],
      }
    const commit = namesObject(g, word.value, 'commit', env)
    if (commit === true) return null
    const guessed =
      commit === false && !has('--no-guess')
        ? guessedBranch(g, word.value, env)
        : false
    if (guessed === true) return null
    if (commit === null || guessed === null)
      return {
        paths: pathsOf(command, before),
        unsure: [`se "${word.value}" é uma branch ou um caminho`],
      }
    return { paths: pathsOf(command, before), unsure: [] }
  }
  const split = splitTreeish(command, g, operands, env, 'tree', read)
  if (split.paths.length === 0)
    return patch ? { paths: null, unsure: split.unsure } : null
  return { paths: split.paths, unsure: split.unsure }
}

/** git reset: --hard, --merge and --keep write the worktree; paths or -p write the index. */
function resetWrite(command, g, env, files, read) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, writeSpecs.reset)
  const has = (...names) => options.some((entry) => names.includes(entry.name))
  if (has('--hard', '--merge', '--keep')) return wholeTree()
  const listed = pathspecFile(command, g.dir, options, files)
  if (listed !== null)
    return { paths: listed.paths, unsure: listed.unsure ? [listed.unsure] : [] }
  const dashed = operands.some((operand) => operand.afterDashes)
  if (!dashed && operands.length === 1 && !has('-p', '--patch')) {
    // `git reset <word>`: a commit moves the branch and the index, and
    // writes no file; anything else is a path.
    const [word] = operands
    const commit =
      wordKnown(command, word.index) && read
        ? namesObject(g, word.value, 'commit', env)
        : null
    if (commit === true) return null
    return {
      paths: pathsOf(command, operands),
      unsure:
        commit === null
          ? [`se "${word.value}" é uma revisão ou um caminho`]
          : [],
    }
  }
  const split = splitTreeish(command, g, operands, env, 'tree', read)
  if (split.paths.length === 0)
    return has('-p', '--patch') ? { paths: null, unsure: split.unsure } : null
  return { paths: split.paths, unsure: split.unsure }
}

/**
 * The write a git command makes to the worktree or the index, or null for
 * none: { paths, unsure }, paths null for the worktree whole. `read` false
 * judges without asking git which words are branches (the directory may not
 * be read), so what a read would settle is unsure.
 * @returns {Write | null}
 */
function writeOf(command, g, sub, env, files, read) {
  const spec = writeSpecs[sub]
  const args = (own = spec ?? {}) => readGitArgs(g.argv, g.at + 1, own)
  if (sub === 'merge' && fastForwardToTrunk(command, g)) return null
  if (Object.hasOwn(wholeWrites, sub)) {
    const { options } = args({})
    const leaves = wholeWrites[sub]
    return options.some((entry) => leaves.includes(entry.name))
      ? null
      : wholeTree()
  }
  switch (sub) {
    case 'checkout':
      return checkoutWrite(command, g, env, files, read)
    case 'reset':
      return resetWrite(command, g, env, files, read)
    case 'restore':
    case 'rm':
    case 'mv':
    case 'clean': {
      const { options, operands } = args()
      const names = options.map((entry) => entry.name)
      if (
        sub !== 'restore' &&
        names.some((name) => name === '-n' || name === '--dry-run')
      )
        return null
      const listed = pathspecFile(command, g.dir, options, files)
      const paths = [...pathsOf(command, operands), ...(listed?.paths ?? [])]
      const unsure = listed?.unsure ? [listed.unsure] : []
      // -x and -X make clean remove ignored files too (writeDecision).
      const ignored =
        sub === 'clean' && names.some((name) => name === '-x' || name === '-X')
          ? { ignored: true }
          : {}
      if (paths.length > 0 || unsure.length > 0)
        return { paths, unsure, ...ignored }
      // With no path, restore and clean take the worktree whole; rm and mv
      // refuse to run.
      return sub === 'restore' || sub === 'clean'
        ? { ...wholeTree(), ...ignored }
        : null
    }
    case 'apply': {
      const { options } = args()
      const names = options.map((entry) => entry.name)
      return names.some((name) => applyReads.has(name)) &&
        !names.includes('--apply')
        ? null
        : wholeTree()
    }
    case 'checkout-index': {
      const { options, operands } = args()
      const names = options.map((entry) => entry.name)
      if (names.includes('--temp')) return null
      if (names.includes('--stdin'))
        return { paths: null, unsure: ['os caminhos que chegam pelo stdin'] }
      const all = names.includes('-a') || names.includes('--all')
      if (!all && operands.length === 0) return null
      const write = all
        ? wholeTree()
        : { paths: pathsOf(command, operands), unsure: [] }
      // With --prefix, the files land under it, not in place.
      const prefix = options.filter((entry) => entry.name === '--prefix').at(-1)
      if (prefix !== undefined && prefix.value !== null)
        write.landsIn = {
          value: prefix.value,
          known: wordKnown(command, prefix.index),
        }
      return write
    }
    case 'update-index': {
      const { options, operands } = args({})
      if (
        operands.length === 0 &&
        options.every((entry) => refreshOnly.has(entry.name))
      )
        return null
      return wholeTree()
    }
    case 'stash': {
      // `git stash` with no verb, or an option first, is a push.
      const verb = g.argv[g.at + 1]
      if (verb === undefined || verb.startsWith('-')) return null
      if (!wordKnown(command, g.at + 1))
        return { paths: null, unsure: [`o verbo "${verb}" do git stash`] }
      return ['apply', 'pop', 'branch'].includes(verb) ? wholeTree() : null
    }
    case 'sparse-checkout': {
      const verb = g.argv[g.at + 1]
      return ['set', 'add', 'reapply', 'disable', 'init'].includes(verb)
        ? wholeTree()
        : null
    }
    case 'lfs': {
      const verb = g.argv[g.at + 1]
      return ['pull', 'checkout'].includes(verb) ? wholeTree() : null
    }
    case 'mergetool': {
      const { options, operands } = args()
      if (options.some((entry) => entry.name === '--tool-help')) return null
      return operands.length > 0
        ? { paths: pathsOf(command, operands), unsure: [] }
        : wholeTree()
    }
    case 'merge-file': {
      const { options, operands } = args()
      const names = options.map((entry) => entry.name)
      if (
        ['-p', '--stdout', '--object-id'].some((name) => names.includes(name))
      )
        return null
      return operands.length > 0
        ? { paths: pathsOf(command, operands.slice(0, 1)), unsure: [] }
        : null
    }
    default:
      return null
  }
}

/** Pathspec magic the hook reads; any other makes the path unsure. */
const pathspecMagic = new Set(['top', 'literal', 'glob', 'exclude'])

/**
 * Where each path of a write lands, relative to the worktree's top (''
 * for the worktree whole), as git reads a pathspec: relative to the
 * directory git runs in, or to the top with `:/` or `:(top)`; a glob
 * stands for the directory before its first wildcard, once `..` is
 * resolved as git resolves it; `:!`, `:^` and
 * `:(exclude)` take paths away and add none. What cannot be placed (an
 * expansion, `:(icase)`, a work tree named elsewhere, a path outside the
 * worktree) is the worktree whole, and unsure.
 * @returns {{ relatives: string[], unsure: string[] }}
 */
function placeWrite(write, g, found, env) {
  const unsure = [...write.unsure]
  const whole = () => ({ relatives: [''], unsure })
  if (g.workTree || g.gitDir !== null || env.GIT_WORK_TREE) {
    unsure.push('a árvore de trabalho que o comando nomeia')
    return whole()
  }
  const top = realPathOf(found.top)
  const here = realPathOf(g.dir)
  if (within(top, here) === null) {
    unsure.push(`onde ${g.dir} fica no worktree`)
    return whole()
  }
  if (write.landsIn !== undefined) {
    // checkout-index --prefix: a string put before each path, so the
    // directory it names, or the one it ends in, is where files land.
    if (!write.landsIn.known) {
      unsure.push(`o prefixo "${write.landsIn.value}"`)
      return whole()
    }
    const spot = path.resolve(here, write.landsIn.value)
    const dir = write.landsIn.value.endsWith('/') ? spot : path.dirname(spot)
    const relative = within(top, realPathOf(dir))
    // Outside this worktree, it writes none of its files.
    if (relative === null) return { relatives: [], unsure }
    return { relatives: [relative === '' ? '' : `${relative}/`], unsure }
  }
  if (write.paths === null) return whole()
  const literalAll = /^(?:1|true)$/i.test(
    String(env.GIT_LITERAL_PATHSPECS ?? ''),
  )
  const relatives = []
  let included = false
  for (const spec of write.paths) {
    let text = spec.value
    let fromTop = false
    let exclude = false
    let literal = literalAll
    let readable = spec.known
    if (readable && !literalAll && text.startsWith(':(')) {
      const close = text.indexOf(')')
      const magic = close < 0 ? [] : text.slice(2, close).split(',')
      if (close < 0 || magic.some((word) => !pathspecMagic.has(word)))
        readable = false
      fromTop = magic.includes('top')
      exclude = magic.includes('exclude')
      literal = literal || magic.includes('literal')
      text = close < 0 ? '' : text.slice(close + 1)
    } else if (readable && !literalAll && text.startsWith(':')) {
      let at = 1
      while (at < text.length && '/!^'.includes(text[at])) {
        if (text[at] === '/') fromTop = true
        else exclude = true
        at += 1
      }
      if (text[at] === ':') at += 1
      text = text.slice(at)
    }
    if (!readable) {
      unsure.push(`o caminho "${spec.value}"`)
      relatives.push('')
      included = true
      continue
    }
    if (exclude) continue
    included = true
    // git normalizes the path (`.`, `..`) before it matches it, so the glob
    // is cut after: `context/intent/*/../../README.md` is context/README.md.
    const base = fromTop ? top : here
    const relative = within(top, path.resolve(base, text === '' ? '.' : text))
    if (relative === null) {
      unsure.push(`o caminho "${spec.value}", fora do worktree`)
      relatives.push('')
      continue
    }
    // A glob stands for the directory before its first wildcard. The
    // directory git runs in is read as it is written, wildcards and all,
    // unless the path climbs out of it.
    if (!literal) {
      const prefix = within(top, base)
      const kept =
        prefix !== '' &&
        (relative === prefix || relative.startsWith(`${prefix}/`))
          ? prefix.length
          : 0
      const wildcard = relative.slice(kept).search(/[*?[\\]/)
      if (wildcard >= 0) {
        relatives.push(
          relative.slice(0, relative.lastIndexOf('/', kept + wildcard) + 1),
        )
        continue
      }
    }
    // A directory's paths are the ones under it: the intent directory, named
    // with or without its slash, holds only the intent.
    const asDir =
      relative !== '' && (text.endsWith('/') || `${relative}/` === intentDir)
    relatives.push(asDir ? `${relative}/` : relative)
  }
  if (!included) relatives.push('')
  return { relatives, unsure }
}

/**
 * The decision for a write in this project's worktree `found`: every path
 * it lands on, judged as an edit of it, and the refusal made uncertain
 * when a path could not be read.
 */
function writeDecision(write, g, sub, found, ctx, env) {
  if (found.branchKnown === false)
    return unread(
      `não consegui saber em que branch o git ${sub} escreve no worktree: ${headMoved}; confira que ali o gate está aberto`,
    )
  const { relatives, unsure } = placeWrite(write, g, found, env)
  // git clean -x and -X remove ignored files too, and the owner's
  // .claude/settings.local.json is one of them (Copilot review of #45). When
  // what is cleaned holds it, it is judged by name, so the rule that guards
  // it applies. A clean of another folder does not reach it.
  const holdsSettings = (relative) => {
    const dir = fold(relative).replace(/\/$/, '')
    return dir === '' || fold(settingsLocal).startsWith(`${dir}/`)
  }
  if (write.ignored === true && relatives.some(holdsSettings))
    relatives.push(settingsLocal)
  // A folder named as a pathspec covers the files under it, the harness ones
  // too (`git restore scripts`, `git checkout main -- scripts`; Copilot
  // review of #45): each harness path under it is judged by name, so the
  // harness asks as it does for the file itself. The worktree whole ('') is
  // judged as before.
  for (const relative of [...relatives]) {
    const dir = fold(relative).replace(/\/$/, '')
    if (dir === '') continue
    for (const entry of harnessPaths)
      if (fold(entry).startsWith(`${dir}/`)) relatives.push(entry)
  }
  if (relatives.length === 0) return pass()
  const decision = combine(
    [...new Set(relatives)].map((relative) =>
      editDecision(found, relative, ctx.input ?? {}, { repoAt: ctx.repoAt }),
    ),
  )
  if (decision.decision === 'pass') return decision
  const named = relatives.includes('')
    ? ''
    : ` (${relatives.slice(0, 3).join(', ')}${relatives.length > 3 ? ', …' : ''})`
  const reason = `o git ${sub} escreve no worktree${named}: ${decision.reason}`
  if (unsure.length === 0) return { ...decision, reason }
  return unread(
    `${reason} Não consegui ler ${[...new Set(unsure)].join(', ')}: confira.`,
  )
}

// ---------------------------------------------------------------------------
// Writes to main's ref (Copilot review of #26, sixth round)
//
// A commit on main and a push to it are refused above, and a write to the
// worktree goes through the gate; main's ref also moves with neither. `git
// update-ref refs/heads/main <sha>` sets it outright, and with it the branch
// of the owner's main checkout, where git's own guard (a branch checked out
// elsewhere is not forced) does not reach. So every subcommand that writes
// refs is read for a write to main:
// - update-ref, on its argv and in a --stdin batch (-z too): main in any
//   form git writes it under (`main` and `heads/main` shadow the branch for
//   every name git resolves, `refs/heads/main` is it), a symbolic ref
//   followed to what it points at, and HEAD read as the branch of the
//   checkout it names, unless --no-deref, where it is that checkout's HEAD;
// - branch -f/-m/-M/-c/-C/-d/-D, and a plain create, onto or of main;
// - symbolic-ref turning main into a symbolic ref, pointing another ref at
//   main (or at HEAD), or moving the HEAD of the checkout of main;
// - fetch and pull whose refspec, --refmap, or remote.*.fetch set by the
//   command's own `-c` (or an earlier `git config` of the line), lands on
//   main (the repository's config is not read: see fetchSpecsOf);
// - replace of a commit of main's history, which every read of main then
//   sees replaced;
// - checkout -B, switch -C, worktree add -B and subtree --branch onto main,
//   reset of the checkout of main to a commit, rebase of main,
//   filter-branch of main, and fast-import of a commit on main;
// - push to a repository on disk that is this project (`git push .
//   HEAD:main`), in the push rule above.
// A tag named main moves no branch and is left alone; a write to any other
// ref is judged as before. A ref, a batch or a refspec the hook cannot read
// asks, critical.

const trunkMoves = `mover ${trunk} fora de uma PR: a mudança entra em ${trunk} por PR`

/** A ref name as git stores it: runs of `/` folded, a leading `./` dropped. */
const refName = (name) =>
  String(name)
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')

/**
 * Whether a ref name is main, in any form git writes or resolves it under.
 * Case is folded: on a filesystem that does not tell case apart (macOS's by
 * default), a loose refs/heads/MAIN is main's own file (measured on git
 * 2.50: `git update-ref refs/heads/MAIN <sha>`, and `Refs/Heads/Main`, move
 * main).
 */
const isTrunkRef = (name) => trunkRefs.has(refName(name).toLowerCase())

/** A word of the command: its value, and whether it holds no expansion. */
const wordOf = (command, operand) => ({
  value: operand.value,
  known: wordKnown(command, operand.index),
})

const unreadRef = (value, what) =>
  unread(
    `não consegui ler a ref que ${what} escreve ("${value}"): confira que não é ${trunk}`,
  )

/**
 * Where a symbolic ref leads, followed to its end as git follows it:
 * { known: true, target } (target null for a ref that is not symbolic, or
 * none), or { known: false }.
 */
function symbolicTarget(g, ref, env) {
  const run = gitRead(
    g,
    ['symbolic-ref', '-q', '--end-of-options', ref],
    inertEnv(env),
    { configArgs: inertConfig },
  )
  if (run.status === 0) return { known: true, target: run.out.trim() }
  if (run.status === 1) return { known: true, target: null }
  return { known: false }
}

/** HEAD, or `@`, as the branch of the checkout the command runs in. */
function headDecision(repo, what, deref) {
  if (repo.branchKnown === false)
    return unread(
      `não consegui saber em que branch está o HEAD que ${what} escreve: ${headMoved}; confira que não é ${trunk}`,
    )
  if (repo.branch !== trunk) return pass()
  return deny(
    deref
      ? `${trunkMoves} (${what} escreve o HEAD do checkout de ${trunk}, que é ${trunk})`
      : `${trunkMoves} (${what} tira do lugar o HEAD do checkout de ${trunk})`,
  )
}

/**
 * The decision for a write of `ref`: main in any form, HEAD as the branch
 * of the checkout, and, where git follows a symbolic ref (`deref`), what
 * it points at.
 */
function refDecision(g, repo, { value, known }, { what, deref = true }, env) {
  if (!known) return unreadRef(value, what)
  if (isTrunkRef(value)) return deny(`${trunkMoves} (${what} escreve ${value})`)
  if (value === 'HEAD' || value === '@') return headDecision(repo, what, deref)
  if (!deref) return pass()
  const followed = symbolicTarget(g, value, env)
  if (!followed.known)
    return unread(
      `não consegui ler para onde a ref ${value} aponta: confira que ${what} não escreve em ${trunk}`,
    )
  if (followed.target !== null && isTrunkRef(followed.target))
    return deny(
      `${trunkMoves} (${value} aponta para ${followed.target}, e ${what} escreve nela)`,
    )
  return pass()
}

/**
 * The decision for making `name` a symbolic ref to `target`: a write through
 * it later lands where the target leads, and one later on the same line
 * would be judged before the symbolic ref exists. So a symbolic ref that
 * leads to main (main itself, or a symbolic ref to it) is refused where it
 * is made, and so is one to HEAD: the ref is shared by every worktree, and
 * read from the checkout of main, HEAD is main.
 */
function symrefTargetDecision(g, name, target, what, env) {
  if (!target.known)
    return unread(
      `não consegui ler para onde ${what} aponta ${name} ("${target.value}"): confira que não é ${trunk}`,
    )
  const leads = `${what} faz ${name} apontar para ${target.value}, e uma escrita nela cai em ${trunk}`
  if (isTrunkRef(target.value)) return deny(`${trunkMoves} (${leads})`)
  if (target.value === 'HEAD' || target.value === '@')
    return deny(
      `${trunkMoves} (${what} faz ${name} apontar para ${target.value}, que no checkout de ${trunk} é ${trunk})`,
    )
  const followed = symbolicTarget(g, target.value, env)
  if (!followed.known)
    return unread(
      `não consegui ler para onde a ref ${target.value} aponta: confira que ${what} não faz ${name} levar a ${trunk}`,
    )
  return followed.target !== null && isTrunkRef(followed.target)
    ? deny(`${trunkMoves} (${leads}, que aponta para ${followed.target})`)
    : pass()
}

// update-ref

/** The words of an update-ref --stdin batch, and the ones that write. */
const batchVerbs = new Set([
  'update',
  'create',
  'delete',
  'verify',
  'symref-update',
  'symref-create',
  'symref-delete',
  'symref-verify',
  'option',
  'start',
  'prepare',
  'commit',
  'abort',
])
const batchWrites = new Set([
  'update',
  'create',
  'delete',
  'symref-update',
  'symref-create',
  'symref-delete',
])
const batchBare = new Set(['start', 'prepare', 'commit', 'abort'])

/** How many NUL-ended fields each verb takes after its ref, with -z. */
const batchFields = {
  update: 2,
  create: 1,
  delete: 1,
  verify: 1,
  'symref-update': 1,
  'symref-create': 1,
  'symref-delete': 1,
  'symref-verify': 1,
}

const cEscapes = {
  a: 7,
  b: 8,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  '\\': 92,
  '"': 34,
}

/**
 * A C-quoted word at the start of `text`, as update-ref unquotes a ref:
 * { value, rest }, or null when the quoting cannot be read.
 */
function unquoteC(text) {
  const bytes = []
  for (let k = 1; k < text.length;) {
    const ch = text[k]
    if (ch === '"')
      return {
        value: Buffer.from(bytes).toString('utf8'),
        rest: text.slice(k + 1),
      }
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'))
      k += ch.length
      continue
    }
    const next = text[k + 1]
    if (next !== undefined && Object.hasOwn(cEscapes, next)) {
      bytes.push(cEscapes[next])
      k += 2
      continue
    }
    const octal = text.slice(k + 1, k + 4)
    if (!/^[0-3][0-7]{2}$/.test(octal)) return null
    bytes.push(Number.parseInt(octal, 8))
    k += 4
  }
  return null
}

/**
 * The refs an update-ref --stdin batch writes, as [{ value, known, deref }],
 * or null when a command of it cannot be read. `option no-deref` holds for
 * the next command only; a symref-* command writes the symbolic ref itself.
 */
function batchRefs(text, nul) {
  const writes = []
  let noDeref = false
  const take = (verb, ref, target) => {
    if (batchWrites.has(verb))
      writes.push({
        value: ref,
        known: true,
        deref: !noDeref && !verb.startsWith('symref-'),
        ...(['symref-create', 'symref-update'].includes(verb)
          ? { target: { value: target ?? '', known: target != null } }
          : {}),
      })
    noDeref = false
  }
  if (nul) {
    const fields = text.split('\0')
    for (let k = 0; k < fields.length;) {
      const field = fields[k]
      k += 1
      if (field === '' && k === fields.length) break
      const match = /^([a-z-]+)(?: ([\s\S]*))?$/.exec(field)
      if (match === null || !batchVerbs.has(match[1])) return null
      const [, verb, rest] = match
      if (batchBare.has(verb)) continue
      if (verb === 'option') {
        if (rest !== 'no-deref') return null
        noDeref = true
        continue
      }
      if (rest === undefined || rest === '') return null
      const target = fields[k]
      k += batchFields[verb]
      if (verb === 'symref-update' && ['ref', 'oid'].includes(fields[k])) k += 2
      take(verb, rest, target)
    }
    return writes
  }
  for (const line of text.split('\n')) {
    if (line === '') continue
    const match = /^([a-z-]+)(?: (.*))?$/.exec(line)
    if (match === null || !batchVerbs.has(match[1])) return null
    const [, verb, rest] = match
    if (batchBare.has(verb)) continue
    if (verb === 'option') {
      if (rest !== 'no-deref') return null
      noDeref = true
      continue
    }
    if (rest === undefined || rest === '') return null
    const words = []
    let left = rest
    while (left !== '' && words.length < 2) {
      if (left.startsWith('"')) {
        const quoted = unquoteC(left)
        if (quoted === null) return null
        words.push(quoted.value)
        left = quoted.rest.replace(/^ /, '')
      } else {
        const space = left.indexOf(' ')
        words.push(space < 0 ? left : left.slice(0, space))
        left = space < 0 ? '' : left.slice(space + 1)
      }
    }
    take(verb, words[0], words[1])
  }
  return writes
}

function updateRefPlan(command, g, ctx) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, { short: 'm' })
  const has = (name) => options.some((entry) => entry.name === name)
  const what = 'o git update-ref'
  if (has('--stdin'))
    return (repo, env) => {
      const read = readSource(command, ctx.cwd, '-', true, ctx.files)
      if (!read.known)
        return unread(
          `o git update-ref --stdin lê as refs do stdin, que o hook não leu: confira que nenhuma é ${trunk}`,
        )
      const refs = batchRefs(read.text, has('-z'))
      if (refs === null)
        return unread(
          `não consegui ler inteiro o lote do git update-ref --stdin: confira que ele não escreve em ${trunk}`,
        )
      return combine(
        refs.flatMap((ref) => [
          refDecision(g, repo, ref, { what, deref: ref.deref }, env),
          ref.target === undefined
            ? pass()
            : symrefTargetDecision(g, ref.value, ref.target, what, env),
        ]),
      )
    }
  if (operands.length === 0) return null
  const ref = wordOf(command, operands[0])
  return (repo, env) =>
    refDecision(g, repo, ref, { what, deref: !has('--no-deref') }, env)
}

// branch

/** git branch's options that take a separate value. */
const branchSpec = {
  short: 'u',
  long: [
    '--set-upstream-to',
    '--points-at',
    '--format',
    '--sort',
    '--merged',
    '--no-merged',
    '--contains',
    '--no-contains',
  ],
}

/** The options with which git branch lists, or changes only config. */
const branchReads = [
  '-l',
  '--list',
  '-a',
  '--all',
  '-r',
  '--remotes',
  '-v',
  '--verbose',
  '--show-current',
  '--points-at',
  '--format',
  '--sort',
  '--merged',
  '--no-merged',
  '--contains',
  '--no-contains',
  '--column',
  '--no-column',
  '-u',
  '--set-upstream-to',
  '--unset-upstream',
  '--edit-description',
]

/**
 * The branch names a git branch command writes, as [{ value, known, role
 * }]; `current` stands for the branch checked out, which -m/-c with one
 * name renames or copies.
 */
function branchNames(command, g) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, branchSpec)
  const has = (...names) => options.some((entry) => names.includes(entry.name))
  if (has('-d', '-D', '--delete'))
    return has('-r', '--remotes')
      ? []
      : operands.map((operand) => ({
          ...wordOf(command, operand),
          role: `o git branch apaga ${operand.value}`,
        }))
  const moving = has('-m', '-M', '--move')
  if (moving || has('-c', '-C', '--copy')) {
    const verb = moving ? 'renomeia' : 'copia'
    if (operands.length === 0) return []
    const from =
      operands.length === 1
        ? { current: true, role: `o git branch ${verb} a branch do checkout` }
        : {
            ...wordOf(command, operands[0]),
            role: `o git branch ${verb} ${operands[0].value}`,
          }
    const onto = operands.length === 1 ? operands[0] : operands[1]
    return [
      from,
      {
        ...wordOf(command, onto),
        role: `o git branch ${verb} para ${onto.value}`,
      },
    ]
  }
  if (has(...branchReads) || operands.length === 0) return []
  return [
    {
      ...wordOf(command, operands[0]),
      role: `o git branch ${has('-f', '--force') ? 'força' : 'cria'} ${operands[0].value}`,
    },
  ]
}

function branchPlan(command, g) {
  const names = branchNames(command, g)
  if (
    !names.some((name) => name.current || !name.known || isTrunkRef(name.value))
  )
    return null
  return (repo) =>
    combine(
      names.map((name) => {
        if (name.current) {
          if (repo.branchKnown === false)
            return unread(
              `não consegui saber qual branch ${name.role.replace(' a branch do checkout', '')}: ${headMoved}; confira que não é ${trunk}`,
            )
          return repo.branch === trunk
            ? deny(`${trunkMoves} (${name.role}, ${trunk})`)
            : pass()
        }
        if (!name.known) return unreadRef(name.value, 'o git branch')
        return isTrunkRef(name.value)
          ? deny(`${trunkMoves} (${name.role})`)
          : pass()
      }),
    )
}

// symbolic-ref

function symbolicRefPlan(command, g) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, { short: 'm' })
  const deleting = options.some((entry) =>
    ['-d', '--delete'].includes(entry.name),
  )
  if (operands.length === 0 || (!deleting && operands.length < 2)) return null
  const name = wordOf(command, operands[0])
  const target = deleting ? null : wordOf(command, operands[1])
  if (
    deleting &&
    name.known &&
    !isTrunkRef(name.value) &&
    name.value !== 'HEAD'
  )
    return null
  const what = 'o git symbolic-ref'
  return (repo, env) => {
    if (!name.known) return unreadRef(name.value, what)
    if (isTrunkRef(name.value))
      return deny(
        `${trunkMoves} (${what} ${deleting ? 'apaga' : 'faz uma ref simbólica de'} ${name.value})`,
      )
    // HEAD pointed at main is a checkout of main, which guard-bash follows
    // for the rest of the line; any other name pointed at main is not.
    if (name.value !== 'HEAD')
      return symrefTargetDecision(g, name.value, target, what, env)
    if (repo.branchKnown === false)
      return unread(
        `não consegui saber em que branch está o HEAD que ${what} muda: ${headMoved}; confira que não é o checkout de ${trunk}`,
      )
    if (repo.branch !== trunk) return pass()
    if (deleting)
      return deny(
        `${trunkMoves} (${what} apaga o HEAD do checkout de ${trunk})`,
      )
    if (!target.known)
      return unread(
        `não consegui ler para onde ${what} aponta o HEAD do checkout de ${trunk} ("${target.value}"): confira`,
      )
    return isTrunkRef(target.value)
      ? pass()
      : deny(
          `${trunkMoves} (${what} aponta o HEAD do checkout de ${trunk} para ${target.value})`,
        )
  }
}

// fetch and pull

/** The options of git fetch, and of git pull, that take a separate value. */
const fetchLong = [
  '--depth',
  '--deepen',
  '--shallow-since',
  '--shallow-exclude',
  '--refmap',
  '--server-option',
  '--upload-pack',
  '--negotiation-tip',
  '--jobs',
  '--filter',
  '--submodule-prefix',
  '--recurse-submodules-default',
]
const fetchSpecs = {
  fetch: { short: 'oj', long: fetchLong },
  pull: {
    short: 'sXoj',
    optional: 'S',
    long: [...fetchLong, '--strategy', '--strategy-option'],
  },
}

/**
 * Whether a local destination is main: main in any form, a pattern that
 * covers it, or HEAD, the branch of the checkout.
 */
function fetchLands(dst, repo) {
  if (dst === 'HEAD' || dst === '@')
    return repo.branchKnown === false ? null : repo.branch === trunk
  if (dst.includes('*')) {
    const pattern = new RegExp(
      `^${dst.split('*').map(escapeRegExp).join('.*')}$`,
      'i',
    )
    return [...trunkRefs].some((name) => pattern.test(name))
  }
  return isTrunkRef(dst)
}

/** Where a fetch refspec stores what it fetches, or null for nowhere named. */
function fetchDestination(refspec) {
  const spec = refspec.replace(/^\+/, '')
  if (spec.startsWith('^')) return null
  const colon = spec.indexOf(':')
  if (colon < 0) return null
  return spec.slice(colon + 1) || null
}

function fetchSpecDecision(value, where, repo, sub) {
  const dst = fetchDestination(value)
  if (dst === null) return pass()
  const lands = fetchLands(dst, repo)
  if (lands === null)
    return unread(
      `não consegui saber em que branch o refspec "${value}"${where} do git ${sub} escreve: ${headMoved}; confira que não é ${trunk}`,
    )
  return lands
    ? deny(
        `${trunkMoves} (o refspec "${value}"${where} do git ${sub} escreve em ${trunk})`,
      )
    : pass()
}

/**
 * The refspecs a fetch or a pull stores through, as [{ value, known, where
 * }]: the ones it names, and, for a refspec with no destination (or none at
 * all), the --refmap given, else the remote.*.fetch its own `-c` (or an
 * earlier `git config` of the line) sets. The repository's own config is not
 * read: `git fetch origin` stays free of any git call of the hook's, and
 * git itself refuses to fetch into a branch checked out in any worktree,
 * as main is in the owner's checkout.
 */
function fetchSpecsOf(command, g, sub, options, operands) {
  const has = (...names) => options.some((entry) => names.includes(entry.name))
  const specs = []
  const rest = has('--all', '--multiple') ? [] : operands.slice(1)
  for (let k = 0; k < rest.length; k += 1) {
    const word = wordOf(command, rest[k])
    // `tag <name>` fetches refs/tags/<name> into itself.
    if (word.known && word.value === 'tag') {
      k += 1
      continue
    }
    specs.push({ ...word, where: '' })
  }
  const mapped =
    specs.length === 0 ||
    specs.some(
      (spec) => spec.known && !spec.value.replace(/^\+/, '').includes(':'),
    )
  if (!mapped) return specs
  const refmaps = options.filter((entry) => entry.name === '--refmap')
  if (refmaps.length > 0)
    return [
      ...specs,
      ...refmaps.map((entry) => ({
        value: entry.value ?? '',
        known: wordKnown(command, entry.index),
        where: ' de --refmap',
      })),
    ]
  for (const entry of g.config) {
    const key = keyOf(entry.pair)
    if (key.known && !/^remote\..+\.fetch$/.test(key.key)) continue
    const eq = entry.pair.indexOf('=')
    specs.push({
      value: eq < 0 ? '' : entry.pair.slice(eq + 1),
      known: entry.known && key.known,
      where: key.known ? ` de ${key.key}` : ' de um -c que o hook não lê',
    })
  }
  return specs
}

function fetchPlan(command, g, sub, ctx) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, fetchSpecs[sub])
  const has = (...names) => options.some((entry) => names.includes(entry.name))
  if (has('--dry-run')) return null
  const fromStdin = sub === 'fetch' && has('--stdin')
  const specs = fetchSpecsOf(command, g, sub, options, operands)
  // Every destination spelled, and none of them main nor HEAD: nothing to
  // read in the repository.
  const settled = (spec) => {
    if (!spec.known) return false
    const dst = fetchDestination(spec.value)
    return (
      dst === null ||
      (dst !== 'HEAD' && dst !== '@' && fetchLands(dst, {}) === false)
    )
  }
  if (!fromStdin && specs.every(settled)) return null
  return (repo) => {
    const judged = [...specs]
    if (fromStdin) {
      const read = readSource(command, ctx.cwd, '-', true, ctx.files)
      if (!read.known)
        return unread(
          `o git fetch --stdin lê os refspecs do stdin, que o hook não leu: confira que nenhum escreve em ${trunk}`,
        )
      for (const line of read.text.split('\n'))
        if (line.trim() !== '')
          judged.push({ value: line.trim(), known: true, where: ' do stdin' })
    }
    return combine(
      judged.map((spec) =>
        spec.known
          ? fetchSpecDecision(spec.value, spec.where, repo, sub)
          : unread(
              `não consegui ler o refspec "${spec.value}"${spec.where} do git ${sub}: confira que ele não escreve em ${trunk}`,
            ),
      ),
    )
  }
}

// replace

function replacePlan(command, g) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, {
    long: ['--format'],
  })
  const has = (...names) => options.some((entry) => names.includes(entry.name))
  if (has('-d', '--delete', '-l', '--list')) return null
  if (has('--convert-graft-file'))
    return () =>
      unread(
        `o git replace --convert-graft-file troca os commits do arquivo de grafts, que o hook não lê: confira que nenhum é da história de ${trunk}`,
      )
  if (operands.length === 0) return null
  const object = wordOf(command, operands[0])
  return (repo, env) => {
    if (!object.known)
      return unread(
        `não consegui ler o objeto que o git replace troca ("${object.value}"): confira que não é um commit de ${trunk}`,
      )
    const run = gitRead(
      g,
      [
        'for-each-ref',
        '--format=%(refname)',
        `--contains=${object.value}`,
        `refs/heads/${trunk}`,
        `refs/remotes/*/${trunk}`,
      ],
      inertEnv(env),
      { configArgs: inertConfig },
    )
    if (run.status !== 0)
      return unread(
        `não consegui saber se ${object.value} é da história de ${trunk}: confira que o git replace não troca um commit de ${trunk}`,
      )
    return run.out.trim() === ''
      ? pass()
      : deny(
          `${trunkMoves} (o git replace troca ${object.value}, um commit da história de ${trunk}, em toda leitura de ${trunk})`,
        )
  }
}

// The branch a subcommand forces, resets or rewrites

/** checkout -B, switch -C, worktree add -B and subtree --branch: the branch they force. */
function forcedBranch(command, g, sub) {
  const pick = (from, spec, names) =>
    readGitArgs(g.argv, from, spec)
      .options.filter((entry) => names.includes(entry.name))
      .at(-1)
  let found
  let flag
  if (sub === 'checkout') {
    found = pick(g.at + 1, writeSpecs.checkout, ['-B'])
    flag = '-B'
  } else if (sub === 'switch') {
    found = pick(
      g.at + 1,
      { short: 'cC', long: ['--create', '--force-create', '--orphan'] },
      ['-C', '--force-create'],
    )
    flag = '-C'
  } else if (sub === 'worktree' && g.argv[g.at + 1] === 'add') {
    found = pick(g.at + 2, { short: 'bB', long: ['--reason'] }, ['-B'])
    flag = 'add -B'
  } else if (sub === 'subtree') {
    found = pick(
      g.at + 1,
      {
        short: 'Pmb',
        long: ['--prefix', '--message', '--branch', '--onto', '--annotate'],
      },
      ['-b', '--branch'],
    )
    flag = '--branch'
  }
  if (found?.value == null) return null
  return { value: found.value, known: wordKnown(command, found.index), flag }
}

function forcedPlan(command, g, sub) {
  const branch = forcedBranch(command, g, sub)
  if (branch === null || (branch.known && !isTrunkRef(branch.value)))
    return null
  const what = `o git ${sub} ${branch.flag}`
  return () =>
    branch.known
      ? deny(`${trunkMoves} (${what} ${branch.value} escreve em ${trunk})`)
      : unreadRef(branch.value, what)
}

/** git reset <commit> in the checkout of main moves main to it. */
function resetPlan(command, g) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, writeSpecs.reset)
  if (
    options.some((entry) =>
      ['-p', '--patch', '--pathspec-from-file'].includes(entry.name),
    ) ||
    operands.some((operand) => operand.afterDashes) ||
    operands.length !== 1
  )
    return null
  const word = wordOf(command, operands[0])
  return (repo, env) => {
    if (repo.branchKnown === false)
      return unread(
        `não consegui saber em que branch o git reset roda: ${headMoved}; confira que não é ${trunk}`,
      )
    if (repo.branch !== trunk) return pass()
    const commit = word.known ? namesObject(g, word.value, 'commit', env) : null
    if (commit === false) return pass()
    return commit === true
      ? deny(
          `${trunkMoves} (o git reset leva ${trunk}, a branch do checkout, para ${word.value})`,
        )
      : unread(
          `não consegui saber se "${word.value}" é um commit, para onde o git reset levaria ${trunk}: confira`,
        )
  }
}

/** git rebase <upstream> main checks main out and rewrites it. */
function rebasePlan(command, g) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, {
    short: 'sXx',
    long: ['--onto', '--strategy', '--strategy-option', '--exec'],
  })
  const has = (...names) => options.some((entry) => names.includes(entry.name))
  if (
    has(
      '--continue',
      '--abort',
      '--skip',
      '--quit',
      '--edit-todo',
      '--show-current-patch',
    )
  )
    return null
  const operand = has('--root') ? operands[0] : operands[1]
  if (operand === undefined) return null
  const branch = wordOf(command, operand)
  if (branch.known && !isTrunkRef(branch.value)) return null
  return () =>
    branch.known
      ? deny(`${trunkMoves} (o git rebase reescreve ${branch.value})`)
      : unreadRef(branch.value, 'o git rebase')
}

/** git filter-branch's options that take a separate value. */
const filterSpec = {
  short: 'd',
  long: [
    '--setup',
    '--subdirectory-filter',
    '--env-filter',
    '--tree-filter',
    '--index-filter',
    '--parent-filter',
    '--msg-filter',
    '--commit-filter',
    '--tag-name-filter',
    '--original',
    '--state-branch',
  ],
}

/** The rev-list words that name every branch, main among them. */
const everyBranch = /^--(?:all|branches(?:=.*)?|glob=.*)$/

/** git filter-branch rewrites the branches its rev-list words name. */
function filterPlan(command, g) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, filterSpec)
  const words = [
    ...options
      .filter((entry) => !filterSpec.long.includes(entry.name))
      .map((entry) => ({
        value:
          entry.value === null ? entry.name : `${entry.name}=${entry.value}`,
        known: wordKnown(command, entry.index),
      })),
    ...operands.map((operand) => wordOf(command, operand)),
  ]
  const hits = words.filter((word) => {
    if (!word.known) return true
    if (everyBranch.test(word.value)) return true
    const sides = word.value.includes('...')
      ? word.value.split('...')
      : word.value.includes('..')
        ? [word.value.split('..').at(-1)]
        : [word.value]
    return sides.some(
      (side) =>
        !side.startsWith('^') && isTrunkRef(side.replace(/[~^@].*$/, '')),
    )
  })
  if (hits.length === 0) return null
  return () =>
    combine(
      hits.map((word) =>
        !word.known
          ? unreadRef(word.value, 'o git filter-branch')
          : deny(
              `${trunkMoves} (o git filter-branch reescreve ${everyBranch.test(word.value) ? `todas as branches com ${word.value}, ${trunk} junto` : word.value})`,
            ),
      ),
    )
}

/** git fast-import writes the refs its stream names in commit and reset. */
function fastImportPlan(command, ctx) {
  return () => {
    const read = readSource(command, ctx.cwd, '-', true, ctx.files)
    if (!read.known)
      return unread(
        `o git fast-import lê do stdin as refs que escreve, e o hook não o leu: confira que nenhuma é ${trunk}`,
      )
    const refs = [...read.text.matchAll(/^(?:commit|reset) (.+)$/gm)].map(
      (match) => match[1].trim(),
    )
    const hit = refs.find((ref) => isTrunkRef(ref))
    return hit === undefined
      ? pass()
      : deny(`${trunkMoves} (o git fast-import escreve ${hit})`)
  }
}

/** Subcommands that may write a ref: each is read for a write to main. */
const refWriters = new Set([
  'update-ref',
  'branch',
  'symbolic-ref',
  'fetch',
  'pull',
  'replace',
  'checkout',
  'switch',
  'worktree',
  'subtree',
  'reset',
  'rebase',
  'filter-branch',
  'fast-import',
])

/**
 * What a subcommand writes to main's ref, read from its argv alone: null
 * when it writes none for sure, else a function of the repository (and the
 * environment) that decides, reading git where it must.
 */
function trunkRefPlan(command, g, sub, ctx) {
  switch (sub) {
    case 'update-ref':
      return updateRefPlan(command, g, ctx)
    case 'branch':
      return branchPlan(command, g)
    case 'symbolic-ref':
      return symbolicRefPlan(command, g)
    case 'fetch':
    case 'pull':
      return fetchPlan(command, g, sub, ctx)
    case 'replace':
      return replacePlan(command, g)
    case 'checkout':
    case 'switch':
    case 'worktree':
    case 'subtree':
      return forcedPlan(command, g, sub)
    case 'reset':
      return resetPlan(command, g)
    case 'rebase':
      return rebasePlan(command, g)
    case 'filter-branch':
      return filterPlan(command, g)
    case 'fast-import':
      return fastImportPlan(command, ctx)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// The entry

/**
 * Decision for one SimpleCommand whose argv[0] is 'git', or pass.
 * ctx = {
 *   cwd: the command's directory, absolute;
 *   repoAt: dir -> repoAt(dir), as guard-bash gives it: `branchKnown: false`
 *     when an earlier command of the line moved that repository's HEAD;
 *   cwdKnown: false when the directory came from a `cd` the parser could not
 *     read;
 *   env: the environment the command inherits (process.env by default);
 *   lineConfig: [{ pair: 'key=value', known }] set by earlier `git config`
 *     commands of the line;
 *   files: (path) -> { known, text } for files earlier commands wrote;
 *   cache: a Map the line's alias lookups share.
 * }
 * Only the subcommands with a rule look the repository up, so `git status`
 * and `git log` cost no git call of the hook's own; a word git does not know
 * as a command costs one, to look it up as an alias.
 */
export function gitDecision(command, ctx) {
  const env = envOf(command, ctx)
  const resolved = resolveCommand(command, ctx, env)
  const { g, sub, alias } = resolved
  const argv = g.argv
  if (g.at >= argv.length) return pass()
  if (sub === null)
    return unread(
      `não consegui ler o subcomando do git em "${argv[g.at]}": confira que não é um commit ou um push em ${trunk}, nem uma escrita no worktree com o gate fechado`,
    )
  const via = (resolved.via ?? [])
    .map((step) => `o alias ${step.name} do git é "${step.value}"`)
    .join(', ')
  const decision = decide(resolved, ctx, env)
  if (alias !== null) return decision
  if (via === '' || decision.decision === 'pass') return decision
  return { ...decision, reason: `${via}: ${decision.reason}` }
}

function decide({ command, g, sub, alias }, ctx, env) {
  const argv = g.argv
  if (alias !== null) {
    const reasons = {
      unknown: `não consegui ler o alias ${sub} do git: confira que ele não faz commit nem push em ${trunk}, nem escreve no worktree com o gate fechado`,
      deep: `o alias ${sub} do git leva a aliases demais: confira o que ele roda`,
      shell: `o alias ${sub} do git roda um comando de shell que o hook não confere ("${alias.value}"): confira que ele não faz commit nem push em ${trunk}, nem escreve no worktree com o gate fechado`,
      unreadable: `não consegui ler o alias ${sub} do git ("${alias.value}"): confira que ele não faz commit nem push em ${trunk}, nem escreve no worktree com o gate fechado`,
    }
    return unread(reasons[alias.stop])
  }
  if (!gitCommands.has(sub)) {
    // No alias either: a word git does not know in the subcommand's place is
    // most likely the value of an option the hook does not know, and the
    // real subcommand comes after it.
    const later = argv
      .slice(g.at + 1)
      .find(
        (word, offset) =>
          (guarded.has(word) || writers.has(word) || refWriters.has(word)) &&
          wordKnown(command, g.at + 1 + offset),
      )
    return later === undefined
      ? pass()
      : unread(
          `não reconheci "${sub}" como subcomando nem alias do git, e o comando cita ${later}: confira que não é um commit ou um push em ${trunk}, nem uma escrita no worktree com o gate fechado`,
        )
  }
  // Whether it may write, judged before any git read: the directory is
  // looked at next, and it may not be readable.
  const mayWrite =
    writers.has(sub) && writeOf(command, g, sub, env, ctx.files, false) !== null
  const refPlan = refWriters.has(sub)
    ? trunkRefPlan(command, g, sub, ctx)
    : null
  if (!guarded.has(sub) && !mayWrite && refPlan === null) return pass()
  // A directory that holds an expansion resolves to the nearest one that
  // exists, which may be another worktree on another branch, and one that
  // does not exist yet will be created by the line: either way the verdict
  // would be about the wrong repository.
  if (
    !g.dirKnown ||
    !g.gitDirKnown ||
    ctx.cwdKnown === false ||
    !existsSync(g.dir)
  )
    return unread(
      `não consegui ler o diretório em que o git ${sub} roda: confira que não é ${trunk}${mayWrite ? ', e que ali o gate está aberto para a branch' : ''}`,
    )
  const repo = ctx.repoAt(g.gitDir ?? g.dir)
  if (repo == null) return pass()

  if (sub === 'push') return pushDecision(command, g, repo, env, ctx.repoAt)
  if (!isProject(repo)) return pass()

  const decisions = []
  if (refPlan !== null) decisions.push(refPlan(repo, env))
  const write = mayWrite ? writeOf(command, g, sub, env, ctx.files, true) : null
  if (write !== null)
    decisions.push(writeDecision(write, g, sub, repo, ctx, env))
  if (!guarded.has(sub)) return combine(decisions)
  const rest = argv.slice(g.at + 1)
  if (!rest.some((arg) => leaving.has(arg))) {
    if (repo.branchKnown === false)
      decisions.push(
        unread(
          `não consegui saber em que branch o git ${sub} roda: ${headMoved}; confira que não é ${trunk}`,
        ),
      )
    else if (repo.branch === trunk) decisions.push(deny(commitOnTrunk))
  }
  if (Object.hasOwn(messages, sub))
    decisions.push(
      commitMessage(command, argv, g.dir, g.at + 1, ctx.files, messages[sub]),
    )
  decisions.push(copiedMessage(command, g, sub, env, ctx.files))
  decisions.push(editorDecision(g, sub, env))
  return combine(decisions)
}

// ---------------------------------------------------------------------------
// What a git command changes for the commands after it (guard-bash)

const unknownHead = { known: false, branch: null }

function namedBranch(command, option) {
  if (option?.value == null) return null
  if (!wordKnown(command, option.index)) return unknownHead
  return { known: true, branch: option.value.replace(/^refs\/heads\//, '') }
}

/**
 * The branch checked out after `git checkout`/`switch <word>`, or null for
 * none. With `--track`, the branch created is named after the remote
 * branch without its remote (`origin/main` creates main).
 */
function switchedTo(command, operand, dir, { paths, track = false }) {
  if (!wordKnown(command, operand.index)) return unknownHead
  const word = track
    ? operand.value.replace(/^refs\/remotes\//, '').replace(/^[^/]+\//, '')
    : operand.value
  if (word === '-' || word.startsWith('@{-')) return unknownHead
  if (word === 'HEAD' || word === '@') return null
  if (trunkRefs.has(word)) return { known: true, branch: trunk }
  // `git checkout file` restores a file and leaves HEAD alone.
  if (paths && existsSync(path.resolve(dir, word))) return null
  return { known: true, branch: word }
}

function headAfter(command, g) {
  const { argv, at } = g
  const sub = argv[at]
  const read = (spec) => readGitArgs(argv, at + 1, spec)
  const option = (options, names) =>
    options.filter((entry) => names.includes(entry.name)).at(-1)
  switch (sub) {
    case 'checkout': {
      const { options, operands } = read({
        short: 'bB',
        long: ['--orphan', '--pathspec-from-file'],
      })
      const create = option(options, ['-b', '-B', '--orphan'])
      if (create) return namedBranch(command, create)
      if (option(options, ['--detach'])) return { known: true, branch: null }
      if (option(options, ['--pathspec-from-file', '-p', '--patch']))
        return null
      const before = operands.filter((operand) => !operand.afterDashes)
      if (
        before.length !== 1 ||
        operands.some((operand) => operand.afterDashes)
      )
        return null
      return switchedTo(command, before[0], g.dir, {
        paths: true,
        track: Boolean(option(options, ['-t', '--track'])),
      })
    }
    case 'switch': {
      const { options, operands } = read({
        short: 'cC',
        long: ['--create', '--force-create', '--orphan'],
      })
      const create = option(options, [
        '-c',
        '-C',
        '--create',
        '--force-create',
        '--orphan',
      ])
      if (create) return namedBranch(command, create)
      if (option(options, ['-d', '--detach']))
        return { known: true, branch: null }
      if (operands.length === 0) return null
      return switchedTo(command, operands[0], g.dir, {
        paths: false,
        track: Boolean(option(options, ['-t', '--track'])),
      })
    }
    case 'rebase': {
      const { options, operands } = read({
        short: 'sXx',
        long: ['--onto', '--strategy', '--strategy-option', '--exec'],
      })
      if (option(options, ['--continue', '--abort', '--skip']))
        return unknownHead
      const branch = option(options, ['--root']) ? operands[0] : operands[1]
      if (branch === undefined) return null
      return switchedTo(command, branch, g.dir, { paths: false })
    }
    case 'branch': {
      const { options, operands } = read({})
      if (!option(options, ['-m', '-M', '--move'])) return null
      if (operands.length === 1) return namedBranch(command, operands[0])
      return operands.length > 1 ? unknownHead : null
    }
    case 'symbolic-ref': {
      const { options, operands } = read({ short: 'm' })
      if (operands[0]?.value !== 'HEAD') return null
      if (option(options, ['-d', '--delete'])) return unknownHead
      if (operands[1] === undefined) return null
      return namedBranch(command, operands[1])
    }
    case 'stash': {
      const { operands } = read({})
      if (operands[0]?.value !== 'branch') return null
      return namedBranch(command, operands[1])
    }
    case 'bisect': {
      const { operands } = read({})
      return ['log', 'visualize', 'view', 'terms', 'help'].includes(
        operands[0]?.value,
      )
        ? null
        : unknownHead
    }
    default:
      return null
  }
}

/**
 * What a git command does to the branch checked out, for the commands that
 * come after it on the same line: null when it moves no HEAD, else
 * { dir: where to find the repository, dirKnown, head: { known, branch } },
 * branch null for a detached HEAD. `git reset` moves the branch, not HEAD,
 * so it is not here.
 */
export function headChangeOf(command, ctx) {
  const env = envOf(command, ctx)
  const { command: resolved, g, sub, alias } = resolveCommand(command, ctx, env)
  if (sub === null || alias !== null) return null
  const head = headAfter(resolved, g)
  if (head === null) return null
  return {
    dir: g.gitDir ?? g.dir,
    dirKnown: g.dirKnown && g.gitDirKnown && ctx.cwdKnown !== false,
    head,
  }
}

/**
 * The config an earlier command of the line sets for the ones after it:
 * `git config [scope] <key> <value>` (and `git config set`), and `git remote
 * add|set-url`, which write remote.<name>.url. Each as { pair: 'key=value',
 * known }.
 */
export function configSetBy(command, ctx) {
  const env = envOf(command, ctx)
  const { command: resolved, g, sub } = resolveCommand(command, ctx, env)
  if (sub !== 'config' && sub !== 'remote') return []
  const words = []
  for (let k = g.at + 1; k < g.argv.length; k += 1) {
    const arg = g.argv[k]
    if (['--file', '-f', '--blob', '--type', '--comment'].includes(arg)) {
      k += 1
      continue
    }
    if (arg.startsWith('-')) {
      if (
        sub === 'config' &&
        [
          '--unset',
          '--unset-all',
          '--get',
          '--get-all',
          '--get-regexp',
          '--list',
          '-l',
          '--rename-section',
          '--remove-section',
          '--edit',
          '-e',
        ].includes(arg)
      )
        return []
      continue
    }
    words.push({ value: arg, known: wordKnown(resolved, k) })
  }
  if (sub === 'remote') {
    const [verb, name, url] = words
    if (!['add', 'set-url'].includes(verb?.value) || url === undefined)
      return []
    if (g.argv.includes('--delete')) return []
    const push = g.argv.includes('--push')
    return [
      {
        pair: `remote.${name.value}.${push ? 'pushurl' : 'url'}=${url.value}`,
        known: name.known && url.known,
      },
    ]
  }
  if (
    [
      'set',
      'get',
      'unset',
      'list',
      'edit',
      'rename-section',
      'remove-section',
    ].includes(words[0]?.value)
  ) {
    if (words[0].value !== 'set') return []
    words.shift()
  }
  const [key, value] = words
  if (value === undefined) return []
  return [
    { pair: `${key.value}=${value.value}`, known: key.known && value.known },
  ]
}

// ---------------------------------------------------------------------------
// What a git command changes in the remotes gh reads (guard-bash)

/**
 * The config sections that decide which repository a remote names: the
 * remotes themselves, the rewriting of their URLs (`url.<base>.insteadOf`),
 * and the includes, which can bring either from another file.
 */
const remoteSection = /^(?:remote|url|include|includeif)(?:\.|$)/i

/** git config's options that take a separate value. */
const configValued = new Set([
  '--file',
  '-f',
  '--blob',
  '--type',
  '--comment',
  '--default',
  '--value',
])

/** git config's options with which it only reads. */
const configReads = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '--get-color',
  '--get-colorbool',
  '--list',
  '-l',
  '--blob',
])

/** git config's options with which it writes something else than one value. */
const configRewrites = new Set([
  '--add',
  '--append',
  '--all',
  '--replace-all',
  '--value',
  '--fixed-value',
  '--unset',
  '--unset-all',
  '--rename-section',
  '--remove-section',
  '--edit',
  '-e',
])

/** git config's options that write a file every repository may read. */
const configEverywhere = new Set(['--global', '--system', '--file', '-f'])

/** git config's subcommands (git 2.46 and later). */
const configVerbs = new Set([
  'list',
  'get',
  'set',
  'unset',
  'rename-section',
  'remove-section',
  'edit',
])

const changeNotFollowed = { everywhere: false, origin: null }

/**
 * What `git config` changes in the remotes: null when it only reads, or
 * writes no key of a remoteSection; else { everywhere, origin }, origin
 * being the new URL when the change is a plain set of remote.origin.url.
 * GIT_CONFIG points git config at another file, as `--file` does.
 */
function configRemoteChange(command, argv, from, env) {
  const words = []
  let everywhere = typeof env.GIT_CONFIG === 'string' && env.GIT_CONFIG !== ''
  let reads = false
  let rewrites = false
  let edits = false
  let renames = false
  for (let k = from; k < argv.length; k += 1) {
    const arg = argv[k]
    if (arg.startsWith('-') && arg !== '-') {
      const name = arg.startsWith('--') ? arg.split('=')[0] : arg
      if (configEverywhere.has(name)) everywhere = true
      if (configReads.has(name)) reads = true
      if (configRewrites.has(name)) rewrites = true
      if (name === '--edit' || name === '-e') edits = true
      if (name === '--rename-section') renames = true
      if (configValued.has(arg)) k += 1
      continue
    }
    words.push({ value: arg, known: wordKnown(command, k) })
  }
  let verb = null
  if (words[0] !== undefined && !words[0].known)
    return { everywhere, origin: null }
  if (configVerbs.has(words[0]?.value)) verb = words.shift().value
  if (verb === 'list' || verb === 'get' || (verb === null && reads)) return null
  if (verb === 'edit' || edits) return { everywhere, origin: null }
  const plainSet = (verb === 'set' || verb === null) && !rewrites
  // `git config <key>` alone reads the key.
  if (words.length === 0 || (verb === null && plainSet && words.length < 2))
    return null
  const keys =
    verb === 'rename-section' || renames ? words.slice(0, 2) : words.slice(0, 1)
  if (keys.every((key) => key.known && !remoteSection.test(key.value)))
    return null
  const [key, value] = words
  const origin =
    plainSet &&
    words.length === 2 &&
    canonicalKey(key.value) === 'remote.origin.url'
      ? { known: value.known, url: value.value }
      : null
  return { everywhere, origin }
}

/** The `git remote` verbs that change a remote's name or URLs. */
const remoteVerbs = new Set(['add', 'rename', 'remove', 'rm', 'set-url'])

/**
 * What `git remote` changes: null for the verbs that change no URL (`-v`,
 * `get-url`, `show`, `prune`…), else { everywhere: false, origin }, origin
 * being the new URL of `set-url origin <url>` or `add origin <url>`. An add
 * of a name that exists fails and leaves the old URL, which the caller
 * keeps in mind.
 */
function remoteCommandChange(command, argv, from) {
  const words = []
  const flags = []
  for (let k = from; k < argv.length; k += 1) {
    const arg = argv[k]
    if (arg.startsWith('-') && arg !== '-') {
      flags.push(arg.split('=')[0])
      // add's -t <branch> and -m <master> take a value.
      if (arg === '-t' || arg === '-m') k += 1
      continue
    }
    words.push({ value: arg, known: wordKnown(command, k) })
  }
  const [verb, name, url] = words
  if (verb === undefined) return null
  if (!verb.known) return changeNotFollowed
  if (!remoteVerbs.has(verb.value)) return null
  const setsOrigin =
    (verb.value === 'add' ||
      (verb.value === 'set-url' &&
        !flags.some((flag) =>
          ['--push', '--add', '--delete'].includes(flag),
        ))) &&
    name?.known === true &&
    name.value === 'origin' &&
    words.length === 3
  return {
    everywhere: false,
    origin: setsOrigin ? { known: url.known, url: url.value } : null,
  }
}

/**
 * What a git command changes in the remotes gh reads to pick its repository,
 * for the gh commands after it on the same line (guard-bash; Copilot review
 * of #26): null when it changes none, else { dir, dirKnown, everywhere,
 * origin }.
 * - `dir` is the repository the change lands in (after `-C` and
 *   `--git-dir`), `dirKnown` false when it cannot be read;
 * - `everywhere` when it writes a config every repository may read
 *   (`--global`, `--system`, `--file`), or when what the command runs cannot
 *   be read (a subcommand behind an expansion, an alias not expanded);
 * - `origin` is { known, url } when the change is only a new URL for origin
 *   (`git remote set-url origin <url>`, `git remote add origin <url>`, `git
 *   config remote.origin.url <url>`), else null: a change the hook does not
 *   follow (another remote, a rename, an unset, a rewrite of URLs).
 */
export function remoteChangeOf(command, ctx) {
  const env = envOf(command, ctx)
  const { command: resolved, g, sub, alias } = resolveCommand(command, ctx, env)
  if (g.at >= g.argv.length) return null
  const place = {
    dir: g.gitDir ?? g.dir,
    dirKnown: g.dirKnown && g.gitDirKnown && ctx.cwdKnown !== false,
  }
  let change = null
  if (sub === null || alias !== null)
    change = { everywhere: true, origin: null }
  else if (sub === 'config')
    change = configRemoteChange(resolved, g.argv, g.at + 1, env)
  else if (sub === 'remote')
    change = remoteCommandChange(resolved, g.argv, g.at + 1)
  else if (
    !gitCommands.has(sub) &&
    g.argv
      .slice(g.at + 1)
      .some((word) => word === 'config' || word === 'remote')
  )
    // A word git does not know may be the value of an option the hook does
    // not know, with the real subcommand after it.
    change = { everywhere: true, origin: null }
  return change === null ? null : { ...place, ...change }
}

/**
 * Whether the command defines a git alias (`git config alias.*`, `git -c
 * alias.*`): an indirection the tripwire looks at.
 */
export function definesAlias(command, ctx) {
  const g = globalsOf(command, ctx?.cwd ?? '.', envOf(command, ctx ?? {}))
  if (g.config.some((entry) => /^alias\./i.test(entry.pair))) return true
  return (
    g.argv[g.at] === 'config' &&
    g.argv.slice(g.at + 1).some((word) => /^alias\./i.test(word))
  )
}
