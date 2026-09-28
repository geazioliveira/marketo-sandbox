#!/usr/bin/env node
// The loop gate: which steps of the issue-first loop hold for the work in
// front of you, and whether building (locally) or merging (in CI) may go on.
//
// Ported from brunohab/lite-campaign's scripts/gate.mjs, with three of its
// known defects fixed: Learn was ticked by any mention of #N in the changelog
// (#124), a stacked branch passed and intent-first read the first commit of the
// branch below it (#122), and two state labels at once opened the gate (#103).
// Every rule applied here lives in scripts/loop-sections.mjs; this file only
// gathers facts from git and GitHub and reports them against those rules.
//
// Two modes:
// - local (`npm run gate`): the branch is HEAD. A lost network degrades the
//   issue's steps to unchecked, because a gate that stops work for want of a
//   network is one people learn to route around. A missing issue or a refused
//   credential still blocks: those are answers, not silence.
// - CI (`--pr <n> --branch <headRef>`): fail-closed. issue-link.yml runs the
//   copy of this file from main against a checkout of the PR head, so nothing
//   here may assume it lives in the repository it judges, and the PR's files
//   are read through git (`git show <sha>:<path>`), never through fs. Only
//   this mode reads the PR, and with it the two conditions of a merge (#13):
//   a Copilot review of the PR's head, and no review thread left open.
//
// What it cannot see: the agent posts from the owner's account, so it cannot
// tell who typed an Approve. ownerRule states that convention on every run.
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  approveState,
  branchCategory,
  branchShapes,
  categoryLabels,
  changelogHeadingFor,
  checkSections,
  commentOpening,
  closesLine,
  copilotRequestCommand,
  copilotRequested,
  copilotReviewOn,
  copilotReviewStates,
  countCriteria,
  criteriaSection,
  currentPlan,
  gateCiCommand,
  gateCacheFile,
  gateCacheSchema,
  headAndRest,
  kindOf,
  openThreads,
  ownerRule,
  parseBranch,
  planCitesBranch,
  readyLabel,
  prSizeLimit,
  sectionsFor,
  slicePosition,
  stackOf,
  stackSection,
  stackSliceLabel,
  stateLabels,
  stepIds,
} from './loop-sections.mjs'

const trunk = 'main'
const originTrunk = `refs/remotes/origin/${trunk}`
const intentDir = 'context/intent/'
const changelogPath = 'context/evolution/changelog.md'
// GraphQL pages are read whole or not judged: an Approve or a withdrawal on an
// unread page would silently change the verdict, and so would a state or
// category label past the first page. 100 is the most one page may ask for.
const page = 100

// The sub-issues, each with its repository and labels, are read for a stack's
// parent (#31): every branch its Stack names must be one of its slices.
const issueQuery = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { owner { login } issue(number: $number) { number state body lastEditedAt parent { number repository { nameWithOwner } } labels(first: ${page}) { totalCount nodes { name } } comments(last: ${page}) { totalCount nodes { body createdAt lastEditedAt author { __typename login } } } timelineItems(last: ${page}, itemTypes: [LABELED_EVENT, REOPENED_EVENT, COMMENT_DELETED_EVENT]) { totalCount nodes { __typename ... on LabeledEvent { createdAt actor { __typename login } label { name } } ... on ReopenedEvent { createdAt } ... on CommentDeletedEvent { createdAt } } } subIssues(first: ${page}) { totalCount nodes { number state repository { nameWithOwner } labels(first: ${page}) { totalCount nodes { name } } } } } } }`

// The reviews come newest last, so the last page holds the newest; a Copilot
// review is told apart by its author's type and database id, which only a Bot
// carries, and a failed one by its body (copilotFailedReview). The review
// requests say whether a Copilot review is still on its way, its reviewer
// told apart the same way (copilotRequested). The threads are read first to
// last, each with its first comment, for the link a message gives.
const prQuery = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { baseRefName headRefName headRefOid isDraft body additions deletions changedFiles closingIssuesReferences(first: 10) { totalCount nodes { number repository { nameWithOwner } } } reviews(last: ${page}) { totalCount nodes { state submittedAt commit { oid } author { __typename login ... on Bot { databaseId } } body } } reviewRequests(first: ${page}) { totalCount nodes { requestedReviewer { __typename ... on Bot { databaseId } } } } reviewThreads(first: ${page}) { totalCount nodes { isResolved isOutdated path line comments(first: 1) { nodes { url author { login } } } } } } } }`

/** How many open threads the review-threads step names; the rest are counted. */
const threadsShown = 10

const usage = [
  'Uso:',
  '  node scripts/gate.mjs [--json] [--no-cache]            modo local (a branch é o HEAD)',
  '  node scripts/gate.mjs --pr <n> --branch <headRef> [--json]  modo CI (fail-closed)',
].join('\n')

// ---------------------------------------------------------------------------
// Arguments

function parseArgs(argv) {
  const options = {
    json: false,
    cache: true,
    pr: null,
    branch: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') options.json = true
    else if (arg === '--no-cache') options.cache = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--pr' || arg === '--branch') {
      const key = arg.slice(2)
      const value = argv[i + 1]
      i += 1
      if (value === undefined || value.startsWith('-'))
        return { error: `${arg} precisa de um valor` }
      if (options[key] !== null) return { error: `${arg} repetido` }
      if (key === 'pr') {
        if (!/^[1-9]\d*$/.test(value))
          return { error: `--pr espera o número da PR, recebeu "${value}"` }
        options.pr = Number(value)
      } else options.branch = value
    } else return { error: `opção desconhecida: ${arg}` }
  }
  if ((options.pr === null) !== (options.branch === null))
    return { error: '--pr e --branch andam juntos (modo CI)' }
  return { options }
}

// ---------------------------------------------------------------------------
// git and gh, both through argv (never a shell)

function git(...args) {
  const run = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    ok: !run.error && run.status === 0,
    status: run.status,
    out: run.stdout ?? '',
  }
}

/** Trimmed stdout, or null when git failed. */
function gitOut(...args) {
  const run = git(...args)
  return run.ok ? run.out.trim() : null
}

const isAncestor = (older, newer) =>
  git('merge-base', '--is-ancestor', older, newer).status === 0

/**
 * The best common ancestor of two commits: its sha, false when git says they
 * share no commit (exit 1, nothing printed), or null when git failed. A
 * failure is no proof that two histories share nothing.
 */
function mergeBase(a, b) {
  const run = git('merge-base', a, b)
  if (run.ok) return run.out.trim()
  return run.status === 1 && run.out.trim() === '' ? false : null
}

const hexSha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

/**
 * The commits of a revision range, oldest first, or null when git fails.
 * Parsed so that no byte in a message can break it: rev-list gives the shape
 * (one line of hashes per commit, parents included), and the messages come
 * NUL-separated from git log -z (git refuses a NUL inside a message). A
 * message that cannot be matched to its commit reads as empty, which only
 * ever lands on the reporting or blocking side.
 * @returns {{ sha: string, parents: string[], message: string }[] | null}
 */
function commitsIn(range, { firstParent = false } = {}) {
  const walk = firstParent ? ['--first-parent'] : []
  const shape = git(
    'rev-list',
    '--reverse',
    '--parents',
    ...walk,
    ...range,
    '--',
  )
  if (!shape.ok) return null
  const commits = []
  for (const line of shape.out.split('\n')) {
    const [sha = '', ...parents] = line.trim().split(' ')
    if (hexSha.test(sha) && parents.every((parent) => hexSha.test(parent)))
      commits.push({ sha, parents, message: '' })
  }
  if (commits.length === 0) return commits
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]))
  const read = new Set()
  const parts = git(
    'log',
    '-z',
    '--format=%H%x00%B',
    ...walk,
    ...range,
    '--',
  ).out.split('\0')
  for (let i = 0; i < parts.length - 1; i += 1) {
    const commit = bySha.get(parts[i])
    if (commit === undefined || read.has(commit.sha)) continue
    commit.message = parts[i + 1]
    read.add(commit.sha)
    i += 1
  }
  return commits
}

const firstLine = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? ''

/**
 * One GraphQL call. Never throws, and tells apart the three ways it can fail:
 * lite-campaign's first gate read every non-zero exit as a lost network, and a
 * branch naming an issue nobody had opened sailed through.
 * - missing: GitHub answered that the thing does not exist (blocks);
 * - unverified: gh is absent or the credential was refused (blocks), so
 *   nothing about the issue was verified;
 * - unreachable: anything else (local: unchecked; CI: blocks).
 * The patterns are broad on purpose: a misread error lands on the side that
 * blocks, never on the side that degrades.
 */
function graphql(query, variables) {
  const args = ['api', 'graphql']
  for (const [key, value] of Object.entries(variables))
    args.push('-F', `${key}=${value}`)
  args.push('-f', `query=${query}`)
  const run = spawnSync('gh', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
    },
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (run.error?.code === 'ENOENT')
    return {
      ok: false,
      kind: 'unverified',
      reason: 'gh não está instalado ou não está no PATH',
    }
  if (run.error)
    return {
      ok: false,
      kind: 'unreachable',
      reason:
        run.error.code === 'ETIMEDOUT'
          ? 'gh não respondeu em 30 s'
          : String(run.error.message),
    }
  let payload = null
  try {
    payload = JSON.parse(run.stdout)
  } catch {
    payload = null
  }
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  if (run.status === 0 && errors.length === 0 && payload?.data != null)
    return { ok: true, data: payload.data }
  const text = [
    run.stderr ?? '',
    ...errors.map((e) => `${e?.type ?? ''} ${e?.message ?? ''}`),
  ].join('\n')
  const reason =
    firstLine(run.stderr) ||
    firstLine(errors[0]?.message) ||
    `gh saiu com status ${run.status}`
  if (
    errors.some((e) => e?.type === 'NOT_FOUND') ||
    /could not resolve|not found|HTTP 404/i.test(text)
  )
    return { ok: false, kind: 'missing', reason }
  if (
    /auth|credential|not logged|token|HTTP 401|HTTP 403|bad credentials/i.test(
      text,
    )
  )
    return { ok: false, kind: 'unverified', reason }
  return { ok: false, kind: 'unreachable', reason }
}

/**
 * `owner/name` from an origin URL GitHub hands out, or null: HTTPS, the scp
 * form, or ssh://, each with or without `.git` and a trailing slash.
 */
function parseRemote(url) {
  const matched =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
      String(url ?? '').trim(),
    )
  return matched ? { owner: matched[1], name: matched[2] } : null
}

function realpathOrSelf(target) {
  try {
    return realpathSync.native(target)
  } catch {
    return path.resolve(target)
  }
}

const short = (sha) => String(sha ?? '').slice(0, 7)
const quoted = (items) => items.map((item) => `"${item}"`).join(', ')

/** The commit a review covers, short, or a note when GitHub gave none. */
const reviewedSha = (review) =>
  review.commit?.oid
    ? short(review.commit.oid)
    : 'um commit que o GitHub não informou'

/** What a failed review said (copilotFailedReview), for the message: its first line, quoted. */
const failure = (review) =>
  typeof review.body !== 'string'
    ? ' (o GitHub não deu o corpo dela)'
    : review.body.trim() === ''
      ? ' (o corpo dela veio vazio)'
      : ` ("${firstLine(review.body).slice(0, 200)}")`

/** An open thread as a message names it: `path:line`, its opener and its link. */
function describeThread(thread) {
  const line = Number.isInteger(thread?.line) ? `:${thread.line}` : ''
  const outdated = thread?.isOutdated === true ? ' (desatualizada)' : ''
  const first = thread?.comments?.nodes?.[0]
  const by = first?.author?.login ? ` de ${first.author.login}` : ''
  return `${thread?.path ?? 'arquivo desconhecido'}${line}${outdated}${by} ${first?.url ?? '(sem link)'}`
}

/**
 * Why a connection was not judged: it holds more nodes than the gate read, or
 * GitHub did not say how many it holds.
 */
const partialPage = (total, read, what, judged) =>
  Number.isInteger(total)
    ? `a PR tem ${total} ${what} e o gate leu ${read}; o gate não julga ${judged} sem ler todas`
    : `o GitHub não disse quantas ${what} a PR tem, e o gate não julga ${judged} sem saber se leu todas (leu ${read})`

/** Whether a connection was read whole: its totalCount is known and no larger than its nodes. */
const readWhole = (connection) =>
  Number.isInteger(connection?.totalCount) &&
  connection.totalCount <= (connection?.nodes ?? []).length

// ---------------------------------------------------------------------------
// The run

const marks = { ok: 'x', no: ' ', unchecked: '?', skip: '-' }

function main() {
  const parsedArgs = parseArgs(process.argv.slice(2))
  if (parsedArgs.error) {
    process.stderr.write(`gate: ${parsedArgs.error}\n\n${usage}\n`)
    process.exitCode = 2
    return
  }
  const { options } = parsedArgs
  if (options.help) {
    process.stdout.write(`${usage}\n\n${ownerRule}\n`)
    return
  }

  const ci = options.pr !== null
  const mode = ci ? 'ci' : 'local'
  const steps = new Map(
    stepIds.map((id) => [
      id,
      { id, status: 'skip', blocks: false, detail: '' },
    ]),
  )
  const notes = new Map()
  const set = (id, status, detail, { blocks = false, extra = [] } = {}) => {
    // A typo in a step id would otherwise add a step no test pins.
    if (!steps.has(id)) throw new Error(`passo desconhecido: ${id}`)
    steps.set(id, { id, status, blocks, detail })
    if (extra.length > 0) notes.set(id, extra)
  }
  const skipAll = (detail) => {
    for (const step of steps.values())
      if (step.status === 'skip' && step.detail === '') step.detail = detail
  }
  const head = []
  const tail = []
  const facts = {
    repo: null,
    branch: null,
    issue: null,
    headSha: null,
    verified: false,
    gitDir: null,
  }
  let gateable = false

  const finish = ({ exitOk = false } = {}) => {
    const list = [...steps.values()]
    const blocked = list
      .filter(
        (s) =>
          s.blocks && (s.status === 'no' || (ci && s.status === 'unchecked')),
      )
      .map((s) => s.id)
    const open = gateable && blocked.length === 0
    const result = {
      schema: gateCacheSchema,
      mode,
      repo: facts.repo,
      branch: facts.branch,
      issue: facts.issue,
      headSha: facts.headSha,
      open,
      verified: facts.verified,
      steps: list,
      blocked,
      checkedAt: new Date().toISOString(),
    }

    const lines = [...head]
    for (const step of list) {
      lines.push(
        `  [${marks[step.status]}] ${step.id}${step.detail ? `: ${step.detail}` : ''}`,
      )
      for (const note of notes.get(step.id) ?? []) lines.push(`      ${note}`)
    }
    if (gateable) {
      if (blocked.length > 0) {
        lines.push('', `Build BLOQUEADO na #${facts.issue}:`)
        for (const id of blocked) lines.push(`  ${id}: ${steps.get(id).detail}`)
      } else {
        lines.push('', `O gate está aberto para a #${facts.issue}.`)
        if (list.some((s) => s.status === 'no' || s.status === 'unchecked'))
          lines.push(
            'Os passos sem [x] são os que ainda faltam ou não puderam ser verificados.',
          )
      }
    }
    lines.push(...tail, '', ownerRule)
    const human = `${lines.join('\n')}\n`

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      // The report still reaches a person reading CI logs, without touching
      // the JSON a hook parses from stdout.
      process.stderr.write(human)
    } else process.stdout.write(human)

    // Only the local gate writes the cache the hooks (#5) are to read; a CI verdict
    // describes a PR head, not the worktree someone is building in.
    if (!ci && options.cache) {
      const gitDir = facts.gitDir
      if (gitDir !== null) {
        const cache = {
          schema: gateCacheSchema,
          repo: result.repo,
          branch: result.branch,
          issue: result.issue,
          headSha: result.headSha,
          open: result.open,
          verified: result.verified,
          steps: result.steps,
          checkedAt: result.checkedAt,
        }
        try {
          writeFileSync(
            path.join(gitDir, gateCacheFile),
            `${JSON.stringify(cache, null, 2)}\n`,
          )
        } catch (error) {
          process.stderr.write(
            `gate: não foi possível gravar o cache: ${error.message}\n`,
          )
        }
      }
    }
    process.exitCode = open || exitOk ? 0 : 1
  }

  // 1. The repository. One rev-parse answers both: every spawn counts when
  // the gate runs before each build step.
  const [toplevel = null, gitDir = null] = (
    gitOut('rev-parse', '--show-toplevel', '--absolute-git-dir') ?? ''
  )
    .split('\n')
    .filter(Boolean)
  facts.gitDir = gitDir
  if (toplevel === null) {
    set('repo', 'no', 'o diretório atual não é um repositório git', {
      blocks: true,
    })
    skipAll('não avaliado: não há repositório')
    head.push(
      'Não há repositório git aqui, então não há trabalho para julgar.',
      '',
    )
    finish()
    return
  }
  const remoteUrl = gitOut('remote', 'get-url', 'origin')
  const identity = parseRemote(remoteUrl)
  facts.repo = identity ? `${identity.owner}/${identity.name}` : null
  let canQuery = identity !== null
  {
    const problems = []
    if (identity === null)
      problems.push(
        `o remote origin (${remoteUrl ?? 'ausente'}) não é um repositório do GitHub`,
      )
    if (ci) {
      // In CI the gate is the trusted copy from main and lives outside this
      // checkout, so identity comes from the remote and the workflow's context.
      const expected = process.env.GITHUB_REPOSITORY
      if (
        identity &&
        expected &&
        expected.toLowerCase() !== facts.repo.toLowerCase()
      ) {
        problems.push(
          `origin é ${facts.repo}, mas o workflow roda em ${expected}`,
        )
        canQuery = false
      }
    } else {
      // Locally the gate judges the checkout it belongs to: a worktree's gate
      // run from another worktree would read the wrong branch's files.
      const scriptRoot = path.dirname(
        path.dirname(fileURLToPath(import.meta.url)),
      )
      if (realpathOrSelf(toplevel) !== realpathOrSelf(scriptRoot))
        problems.push(
          `este gate pertence a ${scriptRoot}, mas o repositório atual é ${toplevel}`,
        )
      if (!existsSync(path.join(toplevel, 'AGENTS.md')))
        problems.push(`AGENTS.md não existe em ${toplevel}`)
    }
    set(
      'repo',
      problems.length === 0 ? 'ok' : 'no',
      problems.length === 0
        ? `${facts.repo} em ${toplevel}`
        : problems.join('; '),
      { blocks: true },
    )
  }

  // 2. The branch, and the issue it names.
  const branch = ci
    ? options.branch
    : gitOut('symbolic-ref', '--quiet', '--short', 'HEAD')
  facts.branch = branch
  facts.headSha = gitOut('rev-parse', '--verify', '--quiet', 'HEAD^{commit}')
  const originMain = gitOut(
    'rev-parse',
    '--verify',
    '--quiet',
    `${originTrunk}^{commit}`,
  )

  if (!ci && branch === trunk) {
    if (originMain !== null) {
      const ahead = Number(
        gitOut('rev-list', '--count', `${originMain}..HEAD`) ?? 0,
      )
      const behind = Number(
        gitOut('rev-list', '--count', `HEAD..${originMain}`) ?? 0,
      )
      if (ahead > 0) {
        set(
          'up-to-date',
          'no',
          `${trunk} local está ${ahead} commit(s) à frente de origin/${trunk}; publique ou descarte antes de cortar uma branch`,
        )
        tail.push(
          '',
          `Aviso: ${trunk} local tem ${ahead} commit(s) que origin/${trunk} não tem. Uma branch cortada daqui leva esses commits junto e o gate a recusa como empilhada.`,
        )
      } else
        set(
          'up-to-date',
          'ok',
          behind > 0
            ? `${trunk} local está ${behind} commit(s) atrás de origin/${trunk}; rode git pull`
            : `${trunk} local é igual a origin/${trunk}`,
        )
    } else
      set(
        'up-to-date',
        'unchecked',
        `sem origin/${trunk} local; rode git fetch origin`,
      )
    skipAll(`em ${trunk}: nada em construção`)
    head.push(
      `Em ${trunk}: nada está sendo construído, então não há o que julgar.`,
      '',
    )
    tail.push(
      '',
      `Para começar: escolha uma issue aprovada e corte ${branchShapes} de origin/${trunk} atualizado.`,
    )
    finish({ exitOk: true })
    return
  }

  const named = parseBranch(branch)
  if (named === null) {
    set(
      'branch',
      'no',
      branch === null
        ? 'HEAD destacado (detached): não há branch para julgar'
        : `${branch} não nomeia uma issue`,
      { blocks: true },
    )
    skipAll('não avaliado: a branch não nomeia uma issue')
    head.push(
      branch === null
        ? 'HEAD está destacado (detached), então não há branch para julgar.'
        : `A branch ${branch} não nomeia uma issue.`,
      `Uma branch é ${branchShapes}, cortada de origin/${trunk} atualizado.`,
      'Recusada: não existe lane sem issue (claude/*, batch/ e qualquer outra forma são recusadas).',
      '',
    )
    finish()
    return
  }

  const number = named.issue
  facts.issue = number
  gateable = true
  head.push(
    `Gate do loop para a #${number} em ${branch} (${ci ? `modo CI, PR #${options.pr}` : 'modo local'})`,
    '',
  )

  // 3. The issue, through GraphQL: gh issue view --json exposes neither
  // lastEditedAt, nor the author's type, nor who applied each label.
  const issueStepIds = [
    'issue-open',
    'kind',
    'state-label',
    'sections',
    'criteria',
    'approve',
    'branch-in-plan',
  ]
  let kind = null
  let labelsRead = false
  // The parent whose plan and Approve judge this issue, when it is a slice of
  // a stack (#31), and the slice's place in that stack once the branch is found
  // in the parent's Stack.
  let sliceOf = null
  let slice = null
  const fetched = canQuery
    ? graphql(issueQuery, {
        owner: identity.owner,
        name: identity.name,
        number,
      })
    : {
        ok: false,
        kind: 'skipped',
        reason: 'o passo repo falhou, então o GitHub não foi consultado',
      }
  const issue = fetched.ok ? fetched.data?.repository?.issue : null
  if (fetched.ok && issue == null)
    Object.assign(fetched, {
      ok: false,
      kind: 'missing',
      reason: 'o GitHub respondeu sem a issue',
    })

  if (!fetched.ok) {
    const cause =
      fetched.kind === 'missing'
        ? `a #${number} não existe em ${facts.repo}`
        : fetched.kind === 'unverified'
          ? `nada sobre a #${number} foi verificado: ${fetched.reason}`
          : fetched.kind === 'skipped'
            ? `não lido: ${fetched.reason}`
            : `GitHub inacessível: ${fetched.reason}`
    const refused = fetched.kind === 'missing' || fetched.kind === 'unverified'
    set(
      'issue-open',
      refused ? 'no' : 'unchecked',
      refused && fetched.kind === 'missing'
        ? `${cause} (${fetched.reason})`
        : cause,
      {
        blocks: true,
      },
    )
    for (const id of issueStepIds.slice(1))
      set(id, 'unchecked', refused ? 'não lido: a issue não foi lida' : cause, {
        blocks: true,
      })
    set('size', 'unchecked', 'não lido: a issue não foi lida')
    if (fetched.kind === 'unreachable' && !ci)
      tail.push(
        '',
        'Aviso: a issue não foi lida (GitHub inacessível). Os passos marcados com ? não foram verificados; rode o gate de novo com rede.',
      )
  } else {
    facts.verified = true
    const labels = (issue.labels?.nodes ?? []).map((node) => node.name)
    // The labels are judged only when all of them were read. GitHub orders
    // them by when each was created in the repository, oldest first, so a
    // partial page leaves out the newest ones: a state label deleted and
    // created again, say, whatever order they were applied in. A partial page
    // also leaves labelsRead false for the branch step.
    const labelsTotal = issue.labels?.totalCount
    labelsRead = Number.isInteger(labelsTotal) && labelsTotal <= labels.length

    // A slice of a stack (#31): a sub-issue that carries stackSliceLabel is
    // judged by its parent. Its own labels give the category and hold no
    // state label; the state label, the plan and the Approve are the
    // parent's, read with the same query, and the branch must be in the Stack
    // of the parent's current plan. So every revocation of the parent's
    // Approve holds for all its slices, and a slice is never approved on its
    // own. The parent is read only for a sub-issue that asks for it: every
    // other issue is judged as before, whatever its parent.
    const sliceAsked = labelsRead && labels.includes(stackSliceLabel)
    let judged = {
      issue,
      labels,
      labelsRead,
      owner: fetched.data.repository.owner?.login,
    }
    // Why the parent of a slice could not be judged: refused (no parent, or a
    // parent that is missing or unverified) or only unread (unreachable).
    let parentProblem = null
    if (sliceAsked) {
      const parentNumber = issue.parent?.number
      const parentRepo = issue.parent?.repository?.nameWithOwner
      if (!Number.isInteger(parentNumber))
        parentProblem = {
          refused: true,
          detail: `a #${number} tem a label ${stackSliceLabel}, mas não é sub-issue de nenhuma issue: uma fatia é filha da issue mãe da stack`,
        }
      // A stack lives in one repository: a parent elsewhere is refused, not
      // read as the issue of the same number here.
      else if (
        String(parentRepo ?? '').toLowerCase() !==
        String(facts.repo).toLowerCase()
      ) {
        // An answer that does not name the parent's repository is a partial
        // read: refused, and not verified.
        const unnamed = parentRepo === undefined || parentRepo === null
        if (unnamed) facts.verified = false
        parentProblem = {
          refused: true,
          detail: unnamed
            ? `o GitHub não disse de que repositório é a mãe #${parentNumber} da fatia #${number}`
            : `a mãe da fatia #${number} é ${parentRepo}#${parentNumber}, de outro repositório: uma stack fica num repositório só`,
        }
      } else {
        const parentFetched = graphql(issueQuery, {
          owner: identity.owner,
          name: identity.name,
          number: parentNumber,
        })
        const parent = parentFetched.ok
          ? parentFetched.data?.repository?.issue
          : null
        if (parent != null) {
          const parentLabels = (parent.labels?.nodes ?? []).map(
            (node) => node.name,
          )
          const parentTotal = parent.labels?.totalCount
          const parentLabelsRead =
            Number.isInteger(parentTotal) && parentTotal <= parentLabels.length
          // A stack has one level: the parent of a slice is its root, which
          // carries the state label and the Approve. A parent that is a slice
          // too is refused, with a state label or without one, so no slice is
          // ever judged by the plan of another slice.
          if (parentLabelsRead && parentLabels.includes(stackSliceLabel))
            parentProblem = {
              refused: true,
              detail: `a mãe #${parentNumber} da fatia #${number} também tem a label ${stackSliceLabel}: uma stack não se aninha, e a mãe de uma fatia é a raiz da stack`,
            }
          else {
            judged = {
              issue: parent,
              labels: parentLabels,
              labelsRead: parentLabelsRead,
              owner: parentFetched.data.repository.owner?.login,
            }
            sliceOf = parentNumber
          }
        } else {
          const failed = parentFetched.ok ? 'missing' : parentFetched.kind
          // A parent not read leaves the verdict unverified, whatever the
          // failure, as an issue not read does: the hooks must not take it
          // for a verified verdict.
          facts.verified = false
          if (failed === 'unreachable' && !ci)
            tail.push(
              '',
              `Aviso: a mãe #${parentNumber} não foi lida (GitHub inacessível). Os passos marcados com ? não foram verificados; rode o gate de novo com rede.`,
            )
          parentProblem = {
            refused: failed === 'missing' || failed === 'unverified',
            detail:
              failed === 'missing'
                ? `a mãe #${parentNumber} da fatia #${number} não existe em ${facts.repo}`
                : failed === 'unverified'
                  ? `nada sobre a mãe #${parentNumber} foi verificado: ${parentFetched.reason}`
                  : `a mãe #${parentNumber} não foi lida (GitHub inacessível: ${parentFetched.reason})`,
          }
        }
      }
    }

    const shownState = (state) =>
      state === 'CLOSED' ? 'fechada' : String(state).toLowerCase()
    const parentClosed = sliceOf !== null && judged.issue.state !== 'OPEN'
    set(
      'issue-open',
      issue.state === 'OPEN' && !parentClosed ? 'ok' : 'no',
      issue.state !== 'OPEN'
        ? `#${number} está ${shownState(issue.state)}`
        : parentClosed
          ? `a mãe #${sliceOf} da fatia #${number} está ${shownState(judged.issue.state)}`
          : sliceOf !== null
            ? `#${number} e a mãe #${sliceOf} estão abertas`
            : `#${number} está aberta`,
      { blocks: true },
    )

    // Exactly one state label, and it is the ready one. Checking only for
    // the ready label let `ready-for-human` + `ready-for-agent` open the
    // gate (lite-campaign #103), so contradictions are named.
    const stateVerdict = (states) => ({
      ok: states.length === 1 && states[0] === readyLabel,
      detail:
        states.length === 1 && states[0] === readyLabel
          ? readyLabel
          : states.length === 0
            ? `nenhuma label de estado; o build só começa em ${readyLabel}, que o dono aplica depois do Approve`
            : states.length > 1
              ? `labels de estado contraditórias: ${states.join(', ')}; deve haver só ${readyLabel}`
              : `${states[0]}: o build só começa em ${readyLabel}, que o dono aplica depois do Approve`,
    })
    const partial = (what, total, read) =>
      Number.isInteger(total)
        ? `a issue tem ${total} labels e o gate leu ${read}: ${total - read} ${total - read === 1 ? 'ficou' : 'ficaram'} sem ler, e o gate não julga ${what} sem ler todas`
        : `o GitHub não disse quantas labels a issue tem, e o gate não julga ${what} sem saber se leu todas (leu ${read})`

    if (!labelsRead) {
      set('kind', 'no', partial('a categoria', labelsTotal, labels.length), {
        blocks: true,
      })
      set(
        'state-label',
        'no',
        partial('o estado', labelsTotal, labels.length),
        {
          blocks: true,
        },
      )
    } else {
      const category = kindOf(labels)
      kind = category.kind
      const categoryProblem = (found) =>
        found.length === 0
          ? `nenhuma label de categoria (${categoryLabels.join(' ou ')})`
          : `mais de uma label de categoria: ${found.join(', ')}`
      // A slice's plan is its parent's, judged by the parent's category, so
      // the parent needs exactly one, as every open issue does.
      const parentCategory =
        sliceOf !== null && judged.labelsRead ? kindOf(judged.labels) : null
      const kindProblem = !kind
        ? categoryProblem(category.found)
        : sliceOf === null
          ? null
          : parentCategory === null
            ? `na mãe #${sliceOf}, ${partial('a categoria', judged.issue.labels?.totalCount, judged.labels.length)}`
            : parentCategory.kind === null
              ? `na mãe #${sliceOf}, ${categoryProblem(parentCategory.found)}`
              : null
      set(
        'kind',
        kindProblem === null ? 'ok' : 'no',
        kindProblem ??
          (sliceOf === null
            ? kind
            : `${kind} (a mãe #${sliceOf} é ${parentCategory.kind})`),
        { blocks: true },
      )

      if (parentProblem !== null)
        set(
          'state-label',
          parentProblem.refused ? 'no' : 'unchecked',
          parentProblem.detail,
          { blocks: true },
        )
      else if (sliceOf === null) {
        const verdict = stateVerdict(
          stateLabels.filter((name) => labels.includes(name)),
        )
        set('state-label', verdict.ok ? 'ok' : 'no', verdict.detail, {
          blocks: true,
        })
      } else {
        const own = stateLabels.filter((name) => labels.includes(name))
        if (own.length > 0)
          set(
            'state-label',
            'no',
            `uma fatia não leva label de estado, e a #${number} tem ${own.join(', ')}: o estado é o da mãe #${sliceOf}`,
            { blocks: true },
          )
        else if (!judged.labelsRead)
          set(
            'state-label',
            'no',
            `na mãe #${sliceOf}, ${partial('o estado', judged.issue.labels?.totalCount, judged.labels.length)}`,
            { blocks: true },
          )
        else {
          const verdict = stateVerdict(
            stateLabels.filter((name) => judged.labels.includes(name)),
          )
          set(
            'state-label',
            verdict.ok ? 'ok' : 'no',
            `${verdict.detail}, na mãe #${sliceOf} (a #${number} é uma fatia da stack dela)`,
            { blocks: true },
          )
        }
      }
    }

    if (parentProblem !== null) {
      for (const id of ['sections', 'criteria', 'approve', 'branch-in-plan'])
        set(
          id,
          parentProblem.refused ? 'no' : 'unchecked',
          parentProblem.detail,
          {
            blocks: true,
          },
        )
      set('size', 'unchecked', parentProblem.detail)
    } else {
      const planIssue = judged.issue
      const comments = planIssue.comments?.nodes ?? []
      const events = planIssue.timelineItems?.nodes ?? []
      const plan = currentPlan({ body: planIssue.body, comments })
      const planSource =
        plan.source === 'comment'
          ? `comentário "# Plano" de ${plan.comment.createdAt}${sliceOf === null ? '' : ` na mãe #${sliceOf}`}`
          : sliceOf === null
            ? 'corpo da issue'
            : `corpo da mãe #${sliceOf}`
      // A slice's plan is its parent's, of the parent's category.
      const planKind =
        sliceOf === null
          ? kind
          : judged.labelsRead
            ? kindOf(judged.labels).kind
            : null
      const required = sectionsFor(planKind)
      const { missing, empty } = checkSections(plan.text, planKind)
      const whyOf = new Map(required.map(({ heading, why }) => [heading, why]))
      const sectionProblems = [
        ...(missing.length > 0 ? [`faltam ${quoted(missing)}`] : []),
        ...(empty.length > 0 ? [`vazias ${quoted(empty)}`] : []),
      ]
      set(
        'sections',
        sectionProblems.length === 0 ? 'ok' : 'no',
        sectionProblems.length === 0
          ? `as ${required.length} seções de ${planKind === 'bug' ? 'bug' : 'feature'} estão no plano (${planSource})`
          : `${sectionProblems.join('; ')} (${planSource})`,
        {
          blocks: true,
          extra: [...missing, ...empty].map(
            (heading) => `${heading}: ${whyOf.get(heading)}`,
          ),
        },
      )

      const criteria = countCriteria(criteriaSection(plan.text))
      set(
        'criteria',
        criteria > 0 ? 'ok' : 'no',
        criteria > 0
          ? `${criteria} critério(s) de aceite`
          : 'a seção de critérios de aceite não tem nenhum item de checklist (- [ ] …)',
        { blocks: true },
      )

      const commentsTotal = planIssue.comments?.totalCount ?? 0
      const eventsTotal = planIssue.timelineItems?.totalCount ?? 0
      const inParent = sliceOf === null ? '' : ` (na mãe #${sliceOf})`
      // A slice's own acts count against its parent's Approve, as they would
      // on any issue: reopening it resets the Approve, and so do a withdrawal,
      // a revision or a title naming Approve posted on it, and a comment of it
      // edited or deleted after the Approve. Its labels and an Approve written
      // on it do not count: the Approve and ready-for-agent live on the parent.
      const sliceComments =
        sliceOf === null
          ? []
          : (issue.comments?.nodes ?? []).filter(
              (comment) => commentOpening(comment.body) !== 'approve',
            )
      const sliceEvents =
        sliceOf === null
          ? []
          : (issue.timelineItems?.nodes ?? []).filter(
              (event) => event.__typename !== 'LabeledEvent',
            )
      const sliceCommentsTotal =
        sliceOf === null ? 0 : (issue.comments?.totalCount ?? 0)
      const sliceEventsTotal =
        sliceOf === null ? 0 : (issue.timelineItems?.totalCount ?? 0)
      if (commentsTotal > page || eventsTotal > page) {
        set(
          'approve',
          'no',
          `a issue tem ${commentsTotal} comentário(s) e ${eventsTotal} evento(s) de label, reabertura ou comentário apagado; o gate lê só os últimos ${page} de cada e não julga o Approve sem ler tudo${inParent}`,
          { blocks: true },
        )
      } else if (sliceCommentsTotal > page || sliceEventsTotal > page) {
        set(
          'approve',
          'no',
          `a fatia #${number} tem ${sliceCommentsTotal} comentário(s) e ${sliceEventsTotal} evento(s) de label, reabertura ou comentário apagado; o gate lê só os últimos ${page} de cada e não julga o Approve da mãe #${sliceOf} para ela sem ler tudo`,
          { blocks: true },
        )
      } else {
        const approve = approveState({
          issue: { lastEditedAt: planIssue.lastEditedAt },
          comments: [...comments, ...sliceComments],
          events: [...events, ...sliceEvents],
          ownerLogin: judged.owner,
        })
        const lastReopen = (list) =>
          list
            .filter((event) => event.__typename === 'ReopenedEvent')
            .map((event) => event.createdAt)
            .sort()
            .at(-1) ?? ''
        const sliceReopen = lastReopen(sliceEvents)
        const reopenedHere =
          sliceReopen !== '' &&
          sliceReopen > lastReopen(events) &&
          (approve.code === 'before-reopen' ||
            approve.code === 'label-before-reopen')
        set(
          'approve',
          approve.ok ? 'ok' : 'no',
          approve.ok || sliceOf === null
            ? `${approve.detail}${inParent}`
            : reopenedHere
              ? `a fatia #${number} foi reaberta em ${sliceReopen}, depois do Approve da mãe #${sliceOf}: reabrir zera o Approve, e vale para ela um Approve novo na mãe, com ${readyLabel} aplicada de novo`
              : `${approve.detail} (na mãe #${sliceOf} e na fatia #${number})`,
          {
            blocks: true,
          },
        )
      }

      if (sliceOf === null) {
        // The exact name, in the section that carries it (Plano for a feature).
        const citation = planCitesBranch(plan.text, branch, kind)
        set(
          'branch-in-plan',
          citation.cited ? 'ok' : 'no',
          citation.cited
            ? `a seção ${citation.heading} do plano cita ${branch}`
            : citation.section
              ? `a seção ${citation.heading} do plano vigente (${planSource}) não cita a branch ${branch}`
              : `o plano vigente (${planSource}) não tem a seção ${citation.heading}, que cita a branch ${branch}`,
          { blocks: true },
        )
      } else {
        // A slice is cited in the parent's Stack, which also gives its place.
        const stack = stackOf(plan.text)
        // The parent is no slice of its own stack.
        const ownBranch = stack.branches.find(
          (listed) => parseBranch(listed)?.issue === sliceOf,
        )
        if (ownBranch !== undefined)
          stack.problems.push(
            `a seção ${stackSection} cita ${ownBranch}, uma branch da própria mãe #${sliceOf}: a mãe não é fatia da stack dela`,
          )
        // Every other branch the Stack names is a slice of this parent: a
        // sub-issue of it, in this repository, with the slice label. Else a
        // branch from outside the stack would pass for a slice below this one,
        // taken as its base and kept out of its own commits, or for a slice
        // above, exempt from stacked. The sub-issues and their labels are
        // read whole, or the Stack is not judged.
        const subs = planIssue.subIssues
        const subNodes = Array.isArray(subs?.nodes) ? subs.nodes : []
        // Each slice's state, for pr-base: a slice below is done only once its
        // sub-issue is closed, which its PR does on merge (Closes #N).
        const subState = new Map()
        if (!(
          Number.isInteger(subs?.totalCount) &&
          subs.totalCount <= subNodes.length
        ))
          stack.problems.push(
            Number.isInteger(subs?.totalCount)
              ? `a mãe #${sliceOf} tem ${subs.totalCount} sub-issues e o gate leu ${subNodes.length}: ele não julga a seção ${stackSection} sem ler todas`
              : `o GitHub não disse quantas sub-issues a mãe #${sliceOf} tem, e o gate não julga a seção ${stackSection} sem saber se leu todas (leu ${subNodes.length})`,
          )
        else {
          const here = String(facts.repo).toLowerCase()
          const slices = new Map()
          for (const node of subNodes) {
            if (
              String(node?.repository?.nameWithOwner ?? '').toLowerCase() !==
              here
            )
              continue
            const names = (node?.labels?.nodes ?? []).map(
              (label) => label?.name,
            )
            const whole =
              Number.isInteger(node?.labels?.totalCount) &&
              node.labels.totalCount <= names.length
            slices.set(
              node.number,
              !whole
                ? 'unread'
                : names.includes(stackSliceLabel)
                  ? 'slice'
                  : 'other',
            )
            subState.set(node.number, node.state)
          }
          for (const listed of stack.branches) {
            const listedIssue = parseBranch(listed)?.issue
            if (listedIssue === sliceOf) continue
            const found = slices.get(listedIssue)
            if (found === undefined)
              stack.problems.push(
                `a seção ${stackSection} cita ${listed}, mas a #${listedIssue} não é sub-issue da mãe #${sliceOf} neste repositório: toda branch da ${stackSection} é de uma fatia da mãe`,
              )
            else if (found === 'other')
              stack.problems.push(
                `a seção ${stackSection} cita ${listed}, mas a #${listedIssue} não tem a label ${stackSliceLabel}: toda branch da ${stackSection} é de uma fatia da mãe`,
              )
            else if (found === 'unread')
              stack.problems.push(
                `a seção ${stackSection} cita ${listed}, e as labels da #${listedIssue} não foram lidas inteiras: o gate não sabe se ela é uma fatia da mãe #${sliceOf}`,
              )
          }
        }
        const position =
          stack.problems.length === 0
            ? slicePosition(stack.branches, branch)
            : null
        if (position !== null)
          slice = {
            parent: sliceOf,
            position,
            branches: stack.branches,
            subState,
          }
        set(
          'branch-in-plan',
          position !== null ? 'ok' : 'no',
          !stack.declared
            ? `o plano vigente (${planSource}) não tem a seção ${stackSection}, que lista as branches das fatias`
            : stack.problems.length > 0
              ? `${stack.problems.join('; ')} (${planSource})`
              : position === null
                ? `a seção ${stackSection} do plano vigente (${planSource}) não cita a branch ${branch}`
                : `a seção ${stackSection} do plano vigente (${planSource}) cita ${branch}: fatia ${position.index + 1} de ${position.count}`,
          { blocks: true },
        )
      }
      set('size', 'ok', `${plan.text.length} caracteres (${planSource})`)
    }
  }

  // 4. The pull request (CI only).
  let pr = null
  if (ci) {
    const prIds = [
      'pr-base',
      'pr-closes',
      'pr-closes-only',
      'pr-first-line',
      'copilot-review',
      'review-threads',
    ]
    const prFetched = canQuery
      ? graphql(prQuery, {
          owner: identity.owner,
          name: identity.name,
          number: options.pr,
        })
      : {
          ok: false,
          kind: 'skipped',
          reason: 'o passo repo falhou, então o GitHub não foi consultado',
        }
    pr = prFetched.ok ? prFetched.data?.repository?.pullRequest : null
    if (!prFetched.ok || pr == null) {
      const missingPr = !prFetched.ok ? prFetched.kind === 'missing' : true
      for (const id of prIds)
        set(
          id,
          missingPr ? 'no' : 'unchecked',
          missingPr
            ? `a PR #${options.pr} não existe em ${facts.repo}`
            : `PR não lida: ${prFetched.reason}`,
          { blocks: true },
        )
      set('pr-size', 'unchecked', 'a PR não foi lida')
      pr = null
    } else {
      // A slice of a stack (#31) may point at the slice right below it, and
      // then stays a draft: a draft cannot be merged, so no slice is merged
      // into another. It leaves draft once the one below is merged and the PR
      // points at main.
      const below = slice?.position.below ?? null
      if (pr.baseRefName === trunk)
        set('pr-base', 'ok', trunk, { blocks: true })
      else if (below !== null && pr.baseRefName === below)
        set(
          'pr-base',
          pr.isDraft === true ? 'ok' : 'no',
          pr.isDraft === true
            ? `${below}, a fatia logo abaixo na stack da #${slice.parent}, com a PR em draft`
            : `a PR aponta para a fatia de baixo (${below}) e não está em draft: com a base na fatia de baixo, a PR fica em draft até ela mergear e esta passar a apontar para ${trunk}`,
          { blocks: true },
        )
      else
        set(
          'pr-base',
          'no',
          `a PR aponta para ${pr.baseRefName}, não para ${trunk}${
            slice === null
              ? ''
              : below === null
                ? ` (a #${number} é a primeira fatia da stack da #${slice.parent})`
                : ` nem para a fatia de baixo, ${below}`
          }`,
          { blocks: true },
        )

      // Only a report: the size of a PR is a signal for splitting a change
      // into a stack, not a rule.
      const additions = pr.additions
      const deletions = pr.deletions
      if (!Number.isInteger(additions) || !Number.isInteger(deletions))
        set(
          'pr-size',
          'unchecked',
          'o GitHub não disse quantas linhas a PR muda',
        )
      else {
        const changed = additions + deletions
        set(
          'pr-size',
          changed <= prSizeLimit ? 'ok' : 'no',
          `${changed} linha(s) alterada(s) (+${additions} −${deletions}) em ${pr.changedFiles ?? '?'} arquivo(s), contra ${pr.baseRefName}${
            changed <= prSizeLimit
              ? ''
              : `; acima da referência de ${prSizeLimit}: considere quebrar a mudança numa stack`
          }`,
        )
      }
      const refs = pr.closingIssuesReferences ?? { totalCount: 0, nodes: [] }
      const sameRepo = (node) =>
        String(node.repository?.nameWithOwner ?? '').toLowerCase() ===
        String(facts.repo).toLowerCase()
      const closed = (refs.nodes ?? []).map((node) =>
        sameRepo(node)
          ? `#${node.number}`
          : `${node.repository?.nameWithOwner}#${node.number}`,
      )
      const closesIt = (refs.nodes ?? []).some(
        (node) => node.number === number && sameRepo(node),
      )
      set(
        'pr-closes',
        closesIt ? 'ok' : 'no',
        closesIt
          ? `a PR fecha a #${number}`
          : refs.totalCount === 0
            ? `a PR não fecha nenhuma issue; a primeira linha do corpo deve ser "Closes #${number}."`
            : `a PR fecha ${closed.join(', ')}, não a #${number}`,
        { blocks: true },
      )
      set(
        'pr-closes-only',
        refs.totalCount === 1 ? 'ok' : 'no',
        refs.totalCount === 1
          ? 'a PR fecha uma issue só'
          : refs.totalCount === 0
            ? 'a PR não fecha nenhuma issue'
            : `a PR fecha ${refs.totalCount} issues (${closed.join(', ')}); deve fechar só a #${number}`,
        { blocks: true },
      )
      const first = headAndRest(pr.body).head
      const closes = closesLine.exec(first)
      set(
        'pr-first-line',
        closes && Number(closes[1]) === number ? 'ok' : 'no',
        closes && Number(closes[1]) === number
          ? first
          : first === ''
            ? `o corpo da PR está vazio; a primeira linha deve ser "Closes #${number}."`
            : `a primeira linha é "${first}"; deve ser exatamente "Closes #${number}."`,
        { blocks: true },
      )

      // A merge waits for a Copilot review of the head and for every review
      // thread, whoever opened it, to be resolved. A draft cannot be merged,
      // so there both are only reported, as intent-first and learn are. A
      // finding only in the review's summary has no thread and is not read:
      // its format is not documented, and the agent handles it in the PR.
      // Every refusal ends with how to renew the verdict once it is fixed:
      // resolving a thread triggers no workflow, and a re-request only brings
      // a review later.
      const reviewBlocks = pr.isDraft !== true
      const request = copilotRequestCommand(options.pr)
      const renew = `depois, renove o veredito na cabeça da PR com ${gateCiCommand(options.pr, options.branch)}`
      const reviews = pr.reviews?.nodes ?? []
      const { review, latest, failed } = copilotReviewOn({
        reviews,
        headRefOid: pr.headRefOid,
      })
      // A Copilot review requested and still to come (copilotRequested) holds
      // the merge even over a review of the head: its threads are not there
      // yet, and a merge before a review lands is how #10 and #11 went. With
      // the requests not all read and Copilot's not among them, one might be
      // pending among the unread, and a review of the head is not judged.
      const requests = pr.reviewRequests?.nodes ?? []
      const requested = copilotRequested(requests)
      const coming = (which) =>
        `${which} revisão do Copilot foi pedida e ainda não chegou (leva uns 6 min): espere-a e trate as threads dela; se ela não chegar em uns 10 min, peça de novo com ${request}`
      // The page is the newest reviews, so a review that counts among them is
      // enough: the older ones left unread cannot undo it. With none among
      // them, an unread one might count, and the step is not judged. A page
      // GitHub did not count is not trusted either way.
      if (
        !readWhole(pr.reviews) &&
        !(review !== null && Number.isInteger(pr.reviews?.totalCount))
      )
        set(
          'copilot-review',
          'unchecked',
          Number.isInteger(pr.reviews?.totalCount)
            ? `a PR tem ${pr.reviews.totalCount} revisões, o gate leu as ${reviews.length} mais recentes e nenhuma delas é uma revisão do Copilot que conta na cabeça ${short(pr.headRefOid)}; as mais antigas ficam sem julgar; ${requested ? coming('uma') : `peça de novo com ${request}`}; ${renew}`
            : `${partialPage(
                pr.reviews?.totalCount,
                reviews.length,
                'revisões',
                'a revisão do Copilot',
              )}; ${renew}`,
          { blocks: reviewBlocks },
        )
      else if (review !== null) {
        const reviewed = `revisão do Copilot na cabeça ${short(pr.headRefOid)} (${review.state} em ${review.submittedAt})${readWhole(pr.reviews) ? '' : `, entre as ${reviews.length} mais recentes de ${pr.reviews.totalCount} revisões`}`
        if (!requested && !readWhole(pr.reviewRequests))
          set(
            'copilot-review',
            'unchecked',
            Number.isInteger(pr.reviewRequests?.totalCount)
              ? `${reviewed}, mas a PR tem ${pr.reviewRequests.totalCount} pedidos de revisão e o gate leu ${requests.length}; sem ler todos, o gate não sabe se outra revisão do Copilot está a caminho; ${renew}`
              : `${reviewed}, mas o GitHub não disse quantos pedidos de revisão a PR tem (o gate leu ${requests.length}), e sem ler todos o gate não sabe se outra revisão do Copilot está a caminho; ${renew}`,
            { blocks: reviewBlocks },
          )
        else
          set(
            'copilot-review',
            requested ? 'no' : 'ok',
            requested
              ? `há uma ${reviewed}, mas ${coming('outra')}; ${renew}`
              : reviewed,
            { blocks: reviewBlocks },
          )
      } else {
        const next = requested ? coming('uma') : `peça de novo com ${request}`
        set(
          'copilot-review',
          'no',
          latest === null
            ? requested
              ? `nenhuma revisão do Copilot nesta PR ainda; ${coming('uma')}; ${renew}`
              : `nenhuma revisão do Copilot nesta PR; ela é pedida automaticamente quando a PR sai de draft e leva uns 6 min, ou peça com ${request}; ${renew}`
            : failed
              ? latest.commit?.oid === pr.headRefOid
                ? `a revisão do Copilot na cabeça ${short(pr.headRefOid)} falhou${failure(latest)}, e uma revisão que falhou não conta; ${next}; ${renew}`
                : `a última revisão do Copilot, de ${reviewedSha(latest)}, falhou${failure(latest)}; nenhuma cobre a cabeça ${short(pr.headRefOid)}; ${next}; ${renew}`
              : !copilotReviewStates.includes(latest.state)
                ? `a última revisão do Copilot, de ${reviewedSha(latest)}, está ${latest.state} e não conta (contam ${copilotReviewStates.join(' e ')}); nenhuma cobre a cabeça ${short(pr.headRefOid)}; ${next}; ${renew}`
                : `a última revisão do Copilot é de ${reviewedSha(latest)}, não da cabeça ${short(pr.headRefOid)}; ${next}; ${renew}`,
          { blocks: reviewBlocks },
        )
      }

      if (!readWhole(pr.reviewThreads))
        set(
          'review-threads',
          'unchecked',
          `${partialPage(
            pr.reviewThreads?.totalCount,
            (pr.reviewThreads?.nodes ?? []).length,
            'threads de revisão',
            'as threads',
          )}; ${renew}`,
          { blocks: reviewBlocks },
        )
      else {
        const total = pr.reviewThreads.totalCount
        const open = openThreads(pr.reviewThreads.nodes)
        const named = open.slice(0, threadsShown).map(describeThread)
        const more = open.length - named.length
        set(
          'review-threads',
          open.length === 0 ? 'ok' : 'no',
          open.length === 0
            ? `nenhuma thread de revisão aberta (${total} no total)`
            : `${open.length} de ${total} thread(s) de revisão aberta(s): ${named.join('; ')}${more > 0 ? `; e mais ${more}` : ''}; responda em cada uma e só então a resolva; ${renew}`,
          { blocks: reviewBlocks },
        )
      }
    }
  } else
    for (const id of [
      'pr-base',
      'pr-closes',
      'pr-closes-only',
      'pr-first-line',
      'copilot-review',
      'review-threads',
      'pr-size',
    ])
      set(id, 'skip', 'só no modo CI')

  // 5. The branch against its issue and, in CI, against the PR.
  {
    const problems = []
    let unknown = null
    // A prefix may ask for a category (a fix is for a bug).
    const category = branchCategory.get(named.prefix)
    if (category !== undefined) {
      if (!labelsRead)
        unknown = `${named.prefix}/ exige a label ${category}, e as labels não foram lidas`
      else if (kind !== category)
        problems.push(
          `uma branch ${named.prefix}/ exige a label ${category} na issue`,
        )
    }
    if (ci) {
      if (pr === null)
        unknown = 'a PR não foi lida, então a cabeça dela não foi conferida'
      else {
        if (pr.headRefName !== branch)
          problems.push(`a PR vem de ${pr.headRefName}, não de ${branch}`)
        if (pr.headRefOid !== facts.headSha)
          problems.push(
            `HEAD (${short(facts.headSha)}) não é a cabeça da PR (${short(pr.headRefOid)})`,
          )
      }
    }
    set(
      'branch',
      problems.length > 0 ? 'no' : unknown !== null ? 'unchecked' : 'ok',
      problems.length > 0
        ? problems.join('; ')
        : (unknown ?? `${branch} nomeia a #${number}`),
      { blocks: true },
    )
  }

  // 6. The history: read from git only, so it works on a PR checkout.
  const learnBlocks = ci && !(pr?.isDraft === true)
  // In a stack (#31) the intent goes with the first slice and the Learn with
  // the last, citing the parent; in the other slices both only report.
  const intentBlocks = learnBlocks && (slice === null || slice.position.first)
  const learnHere = learnBlocks && (slice === null || slice.position.last)
  // Above the first slice, the intent no longer catches a branch cut from
  // work outside the stack; every own commit citing this slice's issue does,
  // so there it blocks too.
  const citeBlocks = learnBlocks && slice !== null && !slice.position.first
  const blocksOf = (id) =>
    id === 'intent-first'
      ? intentBlocks
      : id === 'learn'
        ? learnHere
        : id === 'commits-cite-issue'
          ? citeBlocks
          : false
  if (facts.headSha === null) {
    set('stacked', 'no', 'HEAD não tem commit', { blocks: true })
    for (const id of [
      'up-to-date',
      'intent-first',
      'learn',
      'commits-cite-issue',
    ])
      set(id, 'unchecked', 'HEAD não tem commit', { blocks: blocksOf(id) })
  } else if (originMain === null) {
    set('stacked', 'no', `sem origin/${trunk} local; rode git fetch origin`, {
      blocks: true,
    })
    for (const id of [
      'up-to-date',
      'intent-first',
      'learn',
      'commits-cite-issue',
    ])
      set(id, 'unchecked', `sem origin/${trunk} local; rode git fetch origin`, {
        blocks: blocksOf(id),
      })
  } else {
    // Stacked (lite-campaign #122): a foreign ref shares this branch's history
    // when the commits both have are not all in origin/main. A local main
    // ahead of origin/main and a branch cut from claude/* both land here, and
    // so does a ref that points exactly at HEAD: right after
    // `git switch -c feature/N-x main`, main is HEAD, and that is when the
    // gate must already refuse. Only this branch and its copy on origin are
    // not foreign: refs/heads/<branch> and refs/remotes/origin/<branch>, the
    // refs `pushed` and ownCopyMerge read too. A ref of the same name under
    // another remote is someone else's copy, and is judged like any other.
    // Any other ref named for issue #N is foreign too: one issue has one
    // branch (ADR 0001), and since the commits on both sides cite #N, git
    // cannot tell which one was cut from the other, so neither exemption below
    // applies to it. That covers a branch cut from another branch of #N, the
    // one it was cut from, and a leftover under an old name (`git branch -m`
    // after a push). The remedy depends on the direction: another branch of
    // #N that HEAD already contains is deleted with `git branch -d`, and one
    // that holds commits HEAD lacks is first brought into a single branch.
    // Only two kinds of the remaining refs are exempt:
    // (a) another issue's branch strictly ahead of HEAD, once every commit
    //     HEAD holds outside origin/main cites #N: it was built on top of this
    //     one, and its own gate run is the one that blocks. Before that,
    //     "contains HEAD" also describes the branch this one was cut from, once
    //     it moves on or merges this one back in, and one citing commit is not
    //     enough: the other branch's commits below the cut would ride along;
    // (b) a ref whose shared commits outside origin/main all cite #N: it was
    //     cut from this branch at an earlier commit, and this branch moved on.
    //     Until HEAD holds a commit citing #N (right after a cut), this is
    //     the only exemption that can apply, and it applies to main and
    //     claude/* too: a start point whose unpublished commits all cite #N
    //     passes here, and intent-first judges it.
    // Every other ref, HEAD's own position included, goes through the
    // merge-base test. In CI only published refs exist (refs/remotes/origin/*):
    // a local main ahead or an unpublished claude/* branch is invisible there,
    // so the local run, before the first commit, is where those are caught.
    // git drops the refs already merged into origin/main in one call, so the
    // per-ref checks run only for the few candidates left.
    const cites = new RegExp(`#${number}(?!\\d)`)
    let headCites = null
    const headCitesIssue = () => {
      const mine = (commitsIn(['HEAD', `^${originMain}`]) ?? []).filter(
        (commit) => commit.parents.length <= 1,
      )
      headCites ??=
        mine.length > 0 && mine.every((commit) => cites.test(commit.message))
      return headCites
    }
    const refName = (ref) =>
      ref.startsWith('refs/heads/')
        ? ref.slice('refs/heads/'.length)
        : ref.slice('refs/remotes/'.length).replace(/^[^/]+\//, '')
    const ownRefs = new Set([
      `refs/heads/${branch}`,
      `refs/remotes/origin/${branch}`,
    ])
    const sharing = []
    // Refs git could not compare with HEAD (mergeBase): they block.
    const unread = []
    const shaOf = new Map()
    // A slice of a stack (#31) shares history with the slices below it, by
    // design: their refs are not foreign, and their commits are not this
    // slice's own. A slice above was cut from this one: it is not foreign
    // when every commit it shares with HEAD, outside origin/main and the
    // slices below, cites this slice's issue, and it takes nothing from the
    // own commits. Only this repository's refs count, local or on origin; a
    // copy under another remote is judged like any other ref.
    const stackLower = new Set(slice?.position.lower ?? [])
    const stackUpper = new Set(slice?.position.upper ?? [])
    const stackRef = (ref) => /^refs\/(?:heads|remotes\/origin)\//.test(ref)
    const candidates = (
      gitOut(
        'for-each-ref',
        '--format=%(objectname) %(refname)',
        '--no-merged',
        originMain,
        'refs/heads',
        'refs/remotes',
      ) ?? ''
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const space = line.indexOf(' ')
        return { sha: line.slice(0, space), ref: line.slice(space + 1) }
      })
    const lowerRefs = candidates
      .map(({ ref }) => ref)
      .filter((ref) => stackRef(ref) && stackLower.has(refName(ref)))
    // An exemption needs proof that the ref was cut from this slice: a
    // merge-base git can find, and below it at least one commit of this
    // slice's own, each citing its issue. A ref that shares only origin/main
    // and the slices below was cut from them, not from this one, and one git
    // cannot compare proves nothing: both are judged below like any other.
    const cutFromHere = (sha) => {
      const shared = mergeBase(facts.headSha, sha)
      if (typeof shared !== 'string') return false
      const sharedOwn = commitsIn([
        shared,
        `^${originMain}`,
        ...lowerRefs.map((ref) => `^${ref}`),
      ])
      if (sharedOwn === null) return false
      const own = sharedOwn.filter((commit) => commit.parents.length <= 1)
      return own.length > 0 && own.every((commit) => cites.test(commit.message))
    }
    for (const { sha, ref } of candidates) {
      if (ref.endsWith('/HEAD') || ref === originTrunk || ownRefs.has(ref))
        continue
      if (stackRef(ref)) {
        if (stackLower.has(refName(ref))) continue
        if (stackUpper.has(refName(ref)) && cutFromHere(sha)) continue
      }
      const other = parseBranch(refName(ref))
      const sameIssue = other?.issue === number
      if (
        !sameIssue &&
        other !== null &&
        sha !== facts.headSha &&
        isAncestor(facts.headSha, sha) &&
        headCitesIssue()
      )
        continue
      const shared = mergeBase(facts.headSha, sha)
      // git failing to compare the two is no proof that they share nothing:
      // the ref stays unread, and blocks.
      if (shared === null) {
        unread.push(ref)
        continue
      }
      if (shared === false || isAncestor(shared, originMain)) continue
      const below = commitsIn([shared, `^${originMain}`])
      if (
        !sameIssue &&
        below !== null &&
        below.length > 0 &&
        below.every((commit) => cites.test(commit.message))
      )
        continue
      sharing.push(ref)
      shaOf.set(ref, sha)
    }
    // This branch's own commits: first-parent from HEAD, minus origin/main and
    // minus every ref it shares history with, so a stacked branch is judged by
    // its own first commit and not the one of the branch below (#122).
    // A walk git could not make is no proof of a branch with no commits of
    // its own: it blocks stacked, as a comparison git could not make does.
    const walkedRead = commitsIn(
      [
        'HEAD',
        `^${originMain}`,
        ...sharing.map((ref) => `^${ref}`),
        ...lowerRefs.map((ref) => `^${ref}`),
      ],
      { firstParent: true },
    )
    const walked = walkedRead ?? []
    // Hidden stacking: a merge anywhere on that line whose other parent is
    // not in origin/main brought in work from outside it, and its ref may be
    // gone (`git merge --no-ff side`, then `git branch -D side`), so no ref
    // above shows it. Merging origin/main in stays allowed.
    // In a stack, merging a slice below in (to bring its fixes up) is how a
    // slice is updated, and is not foreign.
    const fromBelow = (parent) =>
      lowerRefs.some((ref) => isAncestor(parent, ref))
    const foreignMerges = walked.filter((commit) =>
      commit.parents
        .slice(1)
        .some(
          (parent) => !isAncestor(parent, originMain) && !fromBelow(parent),
        ),
    )
    // A merge of this branch's own published copy (a `git pull` that made a
    // merge commit) lands above too; the remedy then is a rebase, not a recut.
    const ownCopy = `refs/remotes/origin/${facts.branch}`
    const ownCopyMerge =
      foreignMerges.length > 0 &&
      gitOut('rev-parse', '--verify', '--quiet', ownCopy) !== null &&
      foreignMerges.every((commit) =>
        commit.parents
          .slice(1)
          .every(
            (parent) =>
              isAncestor(parent, originMain) || isAncestor(parent, ownCopy),
          ),
      )
    const shortRef = (ref) => ref.replace(/^refs\/(?:heads|remotes)\//, '')
    // Another branch of #N, local or on origin, gets its own remedy, one per
    // name: its local branch and its copy on origin are one branch. A ref
    // under another remote is left to the recut below, since `git branch -d`
    // does not reach it.
    const ofThisIssue = sharing.filter(
      (ref) =>
        /^refs\/(?:heads|remotes\/origin)\//.test(ref) &&
        parseBranch(refName(ref))?.issue === number,
    )
    const foreign = sharing.filter((ref) => !ofThisIssue.includes(ref))
    // A slice above that shares history with this one but was not cut from
    // it (cutFromHere) is fixed on its own branch, not by recutting this one.
    const upperNotCut = foreign.filter(
      (ref) => stackRef(ref) && stackUpper.has(refName(ref)),
    )
    const upperNames = [...new Set(upperNotCut.map(refName))]
    const otherNames = [...new Set(ofThisIssue.map(refName))]
    // A name whose refs HEAD all contains holds nothing HEAD lacks, so
    // deleting it loses nothing, and `git branch -d` agrees. Any other holds
    // work of its own: it is never to be deleted first, and never with -D.
    const holdsMore = (name) =>
      ofThisIssue.some(
        (ref) =>
          refName(ref) === name && !isAncestor(shaOf.get(ref), facts.headSha),
      )
    // The delete names only the commands for the refs found: `git branch -d`
    // for a local branch, `git push origin --delete` for a copy on origin. A
    // leftover old name after `git branch -m` and a push is on origin alone,
    // and `git branch -d` would fail on it. The tracking ref may outlive the
    // branch on GitHub, so the push comes with the prune that clears it.
    const deleteCommands = (name) => {
      const local = ofThisIssue.includes(`refs/heads/${name}`)
      const published = ofThisIssue.includes(`refs/remotes/origin/${name}`)
      const push = `git push origin --delete ${name}`
      const prune =
        'se ela já não existe no GitHub, com git fetch --prune origin'
      if (local && published)
        return `git branch -d ${name} e com ${push} (${prune})`
      if (published) return `${push} (${prune})`
      return `git branch -d ${name}`
    }
    const sameIssueRemedy = (name) =>
      holdsMore(name)
        ? `a outra branch da #${number}, ${name}, tem commits que esta não tem: fique com uma só, traga para ela o trabalho da outra, e só então apague a outra (git branch -d recusa apagar trabalho não mergeado)`
        : `apague a outra branch da #${number} com ${deleteCommands(name)}`
    const stackProblems = [
      ...(walkedRead === null
        ? [
            'o git não conseguiu ler os commits próprios desta branch (git rev-list --first-parent): o gate não sabe o que ela traz',
          ]
        : []),
      ...(unread.length > 0
        ? [
            `o git não conseguiu comparar ${unread.map(shortRef).join(', ')} com o HEAD: o gate não sabe se compartilham commits que origin/${trunk} não tem`,
          ]
        : []),
      ...(foreign.length > 0
        ? [
            `compartilha commits que origin/${trunk} não tem com ${foreign.map(shortRef).join(', ')}`,
          ]
        : []),
      ...(ofThisIssue.length > 0
        ? [
            `compartilha commits que origin/${trunk} não tem com outra branch da #${number} (${ofThisIssue.map(shortRef).join(', ')}); uma issue tem uma branch só`,
            ...otherNames.map(sameIssueRemedy),
          ]
        : []),
      ...(foreignMerges.length > 0
        ? [
            `um merge traz commits de fora de origin/${trunk}: ${foreignMerges.map((commit) => short(commit.sha)).join(', ')}`,
          ]
        : []),
    ]
    // Another branch of #N carries its own remedy above; a recut is for
    // anything else, and a rebase for a merge of this branch's own copy.
    const recut = ownCopyMerge
      ? 'o merge trouxe a cópia publicada desta própria branch: desfaça-o e traga essa cópia com git pull --rebase (ou --ff-only)'
      : foreign.length > upperNotCut.length || foreignMerges.length > 0
        ? `corte a branch de origin/${trunk} atualizado e traga para ela só o origin/${trunk}`
        : null
    const upperRemedy =
      upperNames.length > 0
        ? `${upperNames.length === 1 ? `a fatia de cima ${upperNames[0]} não foi cortada` : `as fatias de cima ${upperNames.join(', ')} não foram cortadas`} desta: traga esta fatia para ela (git merge origin/${branch}) ou corte-a de novo a partir desta`
        : null
    const remedies = [recut, upperRemedy].filter((text) => text !== null)
    set(
      'stacked',
      stackProblems.length === 0 ? 'ok' : 'no',
      stackProblems.length === 0
        ? slice === null
          ? `nenhuma outra ref compartilha commits que origin/${trunk} não tem, e nenhum merge traz commits de fora dele`
          : `nenhuma ref de fora da stack da #${slice.parent} compartilha commits que origin/${trunk} não tem, e nenhum merge traz commits de fora dele e das fatias de baixo${lowerRefs.length > 0 ? `; as fatias de baixo (${lowerRefs.map(shortRef).join(', ')}) ficam fora dos commits próprios` : ''}`
        : [...stackProblems, ...remedies].join('; '),
      { blocks: true },
    )

    // A slice above the first points at main only once every slice below is
    // merged there: its ref, if any, is in origin/main, and its sub-issue is
    // closed, as its PR leaves it on merge. A missing ref proves nothing (a
    // slice never published, or deleted unmerged), nor does a ref still at
    // main (a slice published before its first commit). Before that, merging
    // this one would bring the slices below, or skip them, without their gate.
    if (
      ci &&
      pr !== null &&
      slice !== null &&
      !slice.position.first &&
      pr.baseRefName === trunk
    ) {
      const unmerged = new Set(lowerRefs.map(refName))
      const pending = slice.position.lower.filter(
        (lower) =>
          unmerged.has(lower) ||
          slice.subState.get(parseBranch(lower)?.issue) !== 'CLOSED',
      )
      if (pending.length > 0)
        set(
          'pr-base',
          'no',
          `a PR aponta para ${trunk}, mas ${pending.length === 1 ? `a fatia de baixo ${pending[0]} ainda não foi mergeada` : `as fatias de baixo ${pending.join(', ')} ainda não foram mergeadas`} em ${trunk} (a sub-issue de cada uma fecha no merge): até lá, a base desta é a fatia logo abaixo (${slice.position.below}), com a PR em draft`,
          { blocks: true },
        )
    }

    const base = gitOut('merge-base', 'HEAD', originMain)
    const behind =
      base === originMain
        ? 0
        : Number(gitOut('rev-list', '--count', `HEAD..${originMain}`) ?? 0)
    set(
      'up-to-date',
      base === originMain ? 'ok' : 'no',
      base === originMain
        ? `contém o topo de origin/${trunk}`
        : `origin/${trunk} tem ${behind} commit(s) que esta branch não tem`,
    )

    const own = walked.filter((commit) => commit.parents.length <= 1)
    // Merge commits are skipped, so the only commits before the first own one
    // are merges, and each must be a clean merge of origin/main: its tree is
    // the tree of a parent origin/main contains. Otherwise it carries content
    // of its own ahead of the intent: a side branch merged in, or a merge of
    // origin/main amended with code (`git commit --amend` after the merge).
    const firstOwn = own.length === 0 ? walked.length : walked.indexOf(own[0])
    const unclean = walked.slice(0, firstOwn).find((merge) => {
      const trees = (
        gitOut(
          'rev-parse',
          ...[merge.sha, ...merge.parents].map((rev) => `${rev}^{tree}`),
        ) ?? ''
      ).split('\n')
      const [tree, ...parentTrees] = trees
      if (!hexSha.test(tree ?? '')) return true
      // The matching parent must also contain every other parent: a merge
      // with `-s ours` keeps an old base's tree and would silently drop what
      // origin/main gained since.
      return !merge.parents.some(
        (parent, i) =>
          parentTrees[i] === tree &&
          isAncestor(parent, originMain) &&
          merge.parents.every((other) => isAncestor(other, parent)),
      )
    })

    if (unclean !== undefined)
      set(
        'intent-first',
        'no',
        `merge com conteúdo próprio antes do intent (${short(unclean.sha)} ${firstLine(unclean.message)}); antes do intent, só um merge limpo de origin/${trunk}`,
        { blocks: intentBlocks },
      )
    else if (own.length === 0)
      set(
        'intent-first',
        'no',
        `nenhum commit próprio ainda; o primeiro deve tocar só ${intentDir}`,
        { blocks: intentBlocks },
      )
    else {
      const first = own[0]
      // -z: paths come raw, so a pt-BR name (feature-criação.md) is not
      // quoted into "feature-cria\303\247\303\243o.md" by core.quotePath.
      const files = git(
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        '--root',
        '-z',
        first.sha,
      )
        .out.split('\0')
        .filter(Boolean)
      const outside = files.filter((file) => !file.startsWith(intentDir))
      set(
        'intent-first',
        files.length > 0 && outside.length === 0 ? 'ok' : 'no',
        files.length === 0
          ? `o primeiro commit próprio (${short(first.sha)}) não toca arquivo nenhum`
          : outside.length === 0
            ? `o primeiro commit próprio (${short(first.sha)}) toca só ${intentDir}`
            : `o primeiro commit próprio (${short(first.sha)}) toca ${outside.slice(0, 3).join(', ')}${outside.length > 3 ? ', …' : ''}`,
        { blocks: intentBlocks },
      )
    }

    // Learn (lite-campaign #124): a changelog entry heading for this issue that
    // this branch added. A mention of #N in prose, or a heading main already
    // had, does not count. A stack's Learn cites its parent (#31).
    const learnIssue = slice === null ? number : slice.parent
    const heading = changelogHeadingFor(learnIssue)
    const headingsIn = (text) =>
      String(text)
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => heading.test(line))
    const atHead = git('show', `HEAD:${changelogPath}`)
    if (!atHead.ok)
      set('learn', 'no', `${changelogPath} não existe em HEAD`, {
        blocks: learnHere,
      })
    else {
      const now = headingsIn(atHead.out)
      const before = new Set(
        now.length === 0 || base === null
          ? []
          : headingsIn(git('show', `${base}:${changelogPath}`).out),
      )
      const added = now.filter((line) => !before.has(line))
      set(
        'learn',
        added.length > 0 ? 'ok' : 'no',
        added.length > 0
          ? `entrada nova no changelog: ${added[0]}`
          : now.length > 0
            ? `o heading da #${learnIssue} já existia no merge-base com origin/${trunk}; esta branch não acrescentou entrada`
            : `nenhum heading "## AAAA-MM-DD: … (#${learnIssue})" em ${changelogPath}`,
        { blocks: learnHere },
      )
    }

    // In a stack, say why a slice only reports what another slice carries.
    if (slice !== null) {
      const first = slice.branches[0]
      const last = slice.branches[slice.branches.length - 1]
      if (!slice.position.first)
        notes.set('intent-first', [
          `só relata: na stack da #${slice.parent}, o intent vai na primeira fatia (${first})`,
        ])
      if (!slice.position.last)
        notes.set('learn', [
          `só relata: na stack da #${slice.parent}, o Learn vai na última fatia (${last}), citando a #${slice.parent}`,
        ])
    }

    const silent = own.filter((commit) => !cites.test(commit.message))
    set(
      'commits-cite-issue',
      own.length === 0 ? 'skip' : silent.length === 0 ? 'ok' : 'no',
      own.length === 0
        ? 'nenhum commit próprio ainda'
        : silent.length === 0
          ? `${own.length} commit(s) próprio(s), todos citam #${number}`
          : `sem #${number}: ${silent
              .slice(0, 3)
              .map(
                (commit) => `${short(commit.sha)} ${firstLine(commit.message)}`,
              )
              .join('; ')}${silent.length > 3 ? '; …' : ''}`,
      { blocks: citeBlocks },
    )
  }

  // 7. Before a PR (local only): nothing uncommitted, and the branch published.
  if (ci) {
    set('worktree-clean', 'skip', 'só no modo local')
    set('pushed', 'skip', 'só no modo local')
  } else {
    const dirty = (git('status', '--porcelain').out ?? '')
      .split('\n')
      .filter(Boolean)
    set(
      'worktree-clean',
      dirty.length === 0 ? 'ok' : 'no',
      dirty.length === 0 ? 'limpa' : `${dirty.length} mudança(s) sem commit`,
    )
    const remote = gitOut(
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${branch}^{commit}`,
    )
    set(
      'pushed',
      remote !== null && remote === facts.headSha ? 'ok' : 'no',
      remote === null
        ? `origin/${branch} não existe: a branch ainda não foi publicada`
        : remote === facts.headSha
          ? `origin/${branch} está em ${short(remote)}`
          : `origin/${branch} está em ${short(remote)}, HEAD em ${short(facts.headSha)}`,
    )
  }

  finish()
}

main()
