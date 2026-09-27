// SessionStart and UserPromptSubmit (#5): what the agent should know before
// it acts, said where it will read it.
//
// At the start of a session: the branch and the issue it names, the state
// of the gate as its cache says (the same gateStatus the build guard reads),
// and the owner rule the gate prints. On every prompt: that approval in the
// chat is not the Approve. The second one is short on purpose, since it
// lands in the context on every turn; it is there because "pode seguir" in
// the chat is exactly what an agent mistakes for the owner's Approve.
//
// Neither event can block, and neither should fail loudly: an error here
// prints nothing and exits 0, and the PreToolUse hooks still guard the acts.
// Only a git that did not answer in time is said (Copilot review of #26,
// seventh round): the run has its own budget (lib/budget.mjs), well below
// the 30 s Claude Code gives each event, and once it or a git's own timeout
// runs out the context says the state could not be read, instead of the
// hook being killed with nothing said.
import path from 'node:path'
import {
  gateStatus,
  gateTtlHours,
  ownerRule,
  parseBranch,
  readyLabel,
} from '../../scripts/loop-sections.mjs'
import { BudgetExhausted, startBudget } from './lib/budget.mjs'
import { contextOutput, readInput } from './lib/io.mjs'
import {
  isProject,
  pendingPlanExists,
  readGateCache,
  repoAt,
  trunk,
} from './lib/repo.mjs'

const reminder = `Lembrete do loop: aprovação no chat não é Approve. O Approve é o comentário do dono na issue cuja primeira linha é # Owner Approve; o agente nunca o escreve nem aplica ${readyLabel}.`

/** Where the work stands: main, a branch that names an issue, or one that names none. */
function branchLine(branch) {
  if (branch === null)
    return 'HEAD destacado: nenhuma branch, nenhuma issue; o gate o recusa.'
  if (branch === trunk) return `Em ${trunk}: nada em construção.`
  const parsed = parseBranch(branch)
  if (parsed === null)
    return `Branch ${branch} não nomeia uma issue: o gate a recusa.`
  return `Branch ${branch} (issue #${parsed.issue}).`
}

/** The gate's state in one line, as gateStatus reads the cache. */
function gateLine({ state, cache }) {
  const checkedAt =
    typeof cache?.checkedAt === 'string' && cache.checkedAt !== ''
      ? cache.checkedAt
      : null
  const when = checkedAt === null ? '' : ` (rodado em ${checkedAt})`
  const rerun = 'rode npm run gate na branch antes de editar'
  switch (state) {
    case 'open':
      return `Gate aberto para a #${cache.issue}${when}.`
    case 'closed':
      return `Gate fechado${when}: rode npm run gate e resolva o que ele aponta.`
    case 'unverified':
      return `Gate sem verificação no GitHub${when}: editar pede confirmação, e em modo autônomo é negado; ${rerun} com o GitHub ao alcance.`
    case 'pending-plan':
      return `Há um plano aceito nesta sessão e ainda não publicado numa issue${checkedAt === null ? '' : `; o gate rodou em ${checkedAt}`}: o gate conta como fechado até o plano ser publicado.`
    case 'stale':
      return `Gate vencido${when}: o cache vale ${gateTtlHours} h; ${rerun}.`
    case 'mismatch':
      return `O cache do gate não é desta branch${when}: ${rerun}.`
    case 'missing':
      return `Gate sem cache nesta worktree: ${rerun}.`
    default:
      return `Estado do gate desconhecido (${state}): ${rerun}.`
  }
}

function sessionStart(input) {
  const cwd = path.resolve(
    typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : '.',
  )
  const repo = repoAt(cwd)
  if (repo === null || !isProject(repo)) return null
  const status = gateStatus(readGateCache(repo.gitDir), {
    branch: repo.branch ?? '',
    pendingPlan: pendingPlanExists(
      repo.commonDir,
      typeof input.session_id === 'string' ? input.session_id : null,
    ),
  })
  return [branchLine(repo.branch), gateLine(status), ownerRule].join('\n')
}

/**
 * Whether an error means git did not answer in time: the run's budget ran
 * out, or one git reached its own timeout (repo.mjs keeps the spawn's error
 * as the cause).
 */
function outOfTime(error) {
  return error instanceof BudgetExhausted || error?.cause?.code === 'ETIMEDOUT'
}

/** What SessionStart says when the state could not be read in time. */
function lateText(error) {
  const within =
    error instanceof BudgetExhausted
      ? `dentro do prazo de ${error.budgetMs / 1000} s do hook`
      : 'a tempo'
  return [
    `Não consegui ler a branch e o gate: o git não respondeu ${within}. Conte o gate como fechado e rode npm run gate na branch antes de editar.`,
    ownerRule,
  ].join('\n')
}

async function main() {
  // Every git this run starts shares one budget, so the run ends before
  // Claude Code's timeout whatever git does.
  startBudget('session-context')
  const input = await readInput()
  if (input === null) return null
  const event = input.hook_event_name
  if (event === 'UserPromptSubmit') return contextOutput(event, reminder)
  if (event === 'SessionStart') {
    let text
    try {
      text = sessionStart(input)
    } catch (error) {
      if (!outOfTime(error)) throw error
      text = lateText(error)
    }
    return text === null ? null : contextOutput(event, text)
  }
  return null
}

try {
  const output = await main()
  if (output !== null) process.stdout.write(`${output}\n`)
} catch {
  // These events cannot block, and a half-read state is worse than none:
  // print nothing, and let the PreToolUse hooks guard the acts themselves.
}
process.exitCode = 0
