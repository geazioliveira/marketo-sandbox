// The rules for `git` (#5): nothing lands on main but through a pull
// request, and no commit message turns the checks off.
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
import { ask, combine, deny, pass } from './io.mjs'
import { isProject, repoFromRemote, trunk } from './repo.mjs'
import { parseCommand, readBody } from './shell.mjs'

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
    }
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

/**
 * git, as the command would see its config: in the command's repository,
 * with its `-c` and its environment (GIT_CONFIG_GLOBAL, GIT_CONFIG_COUNT and
 * the rest), through argv, never a shell. It only reads.
 */
function gitRead(g, args, env) {
  const clean = { ...env }
  for (const name of discoveryVariables) delete clean[name]
  const run = spawnSync(
    'git',
    [
      '-C',
      g.dir,
      ...(g.gitDir === null ? [] : ['--git-dir', g.gitDir]),
      ...g.configArgs,
      ...args,
    ],
    {
      encoding: 'utf8',
      env: { ...clean, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
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
  return { known: true, all, get: (key) => all(key).at(-1) }
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

/**
 * A commit message carrying a skip string. The message is every `-m` and
 * `--message` (git joins them as paragraphs), every `-F`/`--file`, read
 * relative to the command's directory, `-` being stdin, and every
 * `--trailer`. A message that cannot be read (an expansion, a file that is
 * not there) is not refused on its own: a skip string is rare, and asking on
 * every `-m "$msg"` would teach the person to click through. That is a known
 * limit.
 */
function commitMessage(command, argv, dir, from, files) {
  const { options } = readGitArgs(argv, from, commitSpec)
  for (const option of options) {
    let text = null
    if (option.value === null || !wordKnown(command, option.index)) text = null
    else if (option.name === '-m' || option.name === '--message')
      text = option.value
    else if (option.name === '--trailer') text = trailerLine(option.value)
    else if (option.name === '-F' || option.name === '--file')
      text = readSource(command, dir, option.value, true, files).text
    const token = skipTokenIn(text)
    if (token !== null)
      return deny(
        `a mensagem do commit traz "${token}", que faz o GitHub pular os checks do push e do merge: tire-o da mensagem`,
      )
  }
  return pass()
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
 * git resolves to it, the remote's HEAD (which is main), or a pattern.
 */
const reachesTrunk = (ref) =>
  trunkRefs.has(ref) || ref === 'HEAD' || ref.includes('*')

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

function refspecDecision(value, known, repo, deleting, where = '') {
  if (!known)
    return ask(
      `não consegui ler o destino do push em "${value}": confira que não é ${trunk}`,
    )
  if (deleting)
    return reachesTrunk(value.replace(/^\+/, ''))
      ? deny(`${pushToTrunk} (--delete apaga ${trunk})`)
      : pass()
  const destination = destinationOf(value, repo.branch)
  if (destination.matching)
    return deny(
      `${pushToTrunk} (o refspec "${value}"${where} empurra as branches de mesmo nome, ${trunk} junto)`,
    )
  if (destination.viaHead && repo.branchKnown === false)
    return ask(
      `não consegui saber qual branch o refspec "${value}" empurra: ${headMoved}; confira que não é ${trunk}`,
    )
  if (destination.target !== null && reachesTrunk(destination.target))
    return deny(
      `${pushToTrunk} (o refspec "${value}"${where} chega a ${trunk})`,
    )
  return pass()
}

/**
 * The repositories a remote pushes to: its push URLs, as `git remote
 * get-url --push` gives them, or, for a word that names no remote, the URL
 * itself after git's insteadOf rewriting.
 */
function remoteTarget(g, name, env) {
  if (name.startsWith('-')) return { known: false }
  const named = gitRead(g, ['remote', 'get-url', '--push', '--all', name], env)
  let urls = null
  if (named.status === 0) urls = named.out.split('\n').filter(Boolean)
  else if (named.status === 2) {
    const url = gitRead(g, ['ls-remote', '--get-url', name], env)
    if (url.status === 0) urls = url.out.split('\n').filter(Boolean)
  }
  if (urls === null) return { known: false }
  return {
    known: true,
    project: urls.some((url) => isProject(repoFromRemote(url))),
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

function pushDecision(command, g, repo, env) {
  const { options, operands } = readGitArgs(g.argv, g.at + 1, pushSpec)
  const has = (name) => options.some((option) => option.name === name)
  let config = null
  const readConfig = () => {
    config ??= configOf(g, env)
    return config
  }

  // Where the push lands: the remote (or URL) named, `--repo`, or the
  // remote git picks. A remote that cannot be read may be this project.
  const repoOption = options.filter((option) => option.name === '--repo').at(-1)
  const remoteWord =
    operands[0] ??
    (repoOption?.value != null
      ? { value: repoOption.value, index: repoOption.index }
      : undefined)
  let remote = null
  let target = { known: false }
  if (remoteWord !== undefined) {
    if (wordKnown(command, remoteWord.index)) {
      remote = remoteWord.value
      target = remoteTarget(g, remote, env)
    }
  } else {
    const read = readConfig()
    if (read.known) {
      remote = defaultRemote(read, repo.branch)
      target = remoteTarget(g, remote, env)
    }
  }
  if (target.known && !target.project) return pass()

  if (has('--all') || has('--branches'))
    return deny(
      `${pushToTrunk} (${has('--all') ? '--all' : '--branches'} empurra ${trunk} junto)`,
    )
  if (has('--mirror'))
    return deny(`${pushToTrunk} (--mirror empurra ${trunk} junto)`)
  const deleting = has('--delete') || has('-d')

  const refspecs = operands.slice(1)
  if (refspecs.length > 0)
    return combine(
      refspecs.map((refspec) =>
        refspecDecision(
          refspec.value,
          wordKnown(command, refspec.index),
          repo,
          deleting,
        ),
      ),
    )

  // No refspec: git's config decides what goes, and where.
  const read = readConfig()
  if (!read.known)
    return ask(
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
        refspecDecision(
          refspec,
          true,
          repo,
          deleting,
          ` de remote.${remote}.push`,
        ),
      ),
    )
  if (repo.branchKnown === false)
    return ask(
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
    return merge !== undefined && reachesTrunk(merge)
      ? deny(
          `${pushToTrunk} (push.default=${mode} leva a branch ao upstream dela, ${trunk})`,
        )
      : pass()
  }
  if (['simple', 'current', 'nothing'].includes(mode)) return pass()
  return ask(
    `push.default=${mode} não é um modo que o hook conheça: confira que o push não vai para ${trunk}`,
  )
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
    return ask(
      `não consegui ler o subcomando do git em "${argv[g.at]}": confira que não é um commit ou um push em ${trunk}`,
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
      unknown: `não consegui ler o alias ${sub} do git: confira que ele não faz commit nem push em ${trunk}`,
      deep: `o alias ${sub} do git leva a aliases demais: confira o que ele roda`,
      shell: `o alias ${sub} do git roda um comando de shell que o hook não confere ("${alias.value}"): confira que ele não faz commit nem push em ${trunk}`,
      unreadable: `não consegui ler o alias ${sub} do git ("${alias.value}"): confira que ele não faz commit nem push em ${trunk}`,
    }
    return ask(reasons[alias.stop])
  }
  if (!gitCommands.has(sub)) {
    // No alias either: a word git does not know in the subcommand's place is
    // most likely the value of an option the hook does not know, and the
    // real subcommand comes after it.
    const later = argv
      .slice(g.at + 1)
      .find(
        (word, offset) =>
          guarded.has(word) && wordKnown(command, g.at + 1 + offset),
      )
    return later === undefined
      ? pass()
      : ask(
          `não reconheci "${sub}" como subcomando nem alias do git, e o comando cita ${later}: confira que não é um commit ou um push em ${trunk}`,
        )
  }
  if (!guarded.has(sub)) return pass()
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
    return ask(
      `não consegui ler o diretório em que o git ${sub} roda: confira que não é ${trunk}`,
    )
  const repo = ctx.repoAt(g.gitDir ?? g.dir)
  if (repo == null) return pass()

  if (sub === 'push') return pushDecision(command, g, repo, env)
  if (!isProject(repo)) return pass()

  const decisions = []
  const rest = argv.slice(g.at + 1)
  if (!rest.some((arg) => leaving.has(arg))) {
    if (repo.branchKnown === false)
      decisions.push(
        ask(
          `não consegui saber em que branch o git ${sub} roda: ${headMoved}; confira que não é ${trunk}`,
        ),
      )
    else if (repo.branch === trunk) decisions.push(deny(commitOnTrunk))
  }
  if (sub === 'commit')
    decisions.push(commitMessage(command, argv, g.dir, g.at + 1, ctx.files))
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
