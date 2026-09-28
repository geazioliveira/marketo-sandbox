// One time budget for a whole run of a hook (#5; Copilot review of #26).
//
// Claude Code kills a hook past the timeout settings.json gives it, and a
// killed hook is a non-blocking error: the tool call goes through, decided by
// nobody. Each git and gh the hooks start is bounded on its own (10 s for
// git, LOOP_HOOKS_GH_TIMEOUT_MS for gh), but a long command line starts many
// of them one after the other, and the sum can pass the hook's timeout. So a
// run has one deadline, shared by every process it starts: each one's timeout
// is its own or what is left of the budget, whichever is shorter, and once
// the budget is spent no process starts. The hook then answers with the
// budget's reason (guard-bash and build-guard ask, critical; session-context
// says the state could not be read in time), before Claude Code would kill
// it.
//
// The budgets sit well below each hook's timeout in settings.json, so Node's
// start and the final answer fit after the deadline; test/hooks/settings.spec.ts
// reads both, so they cannot drift apart. The environment may lower a budget
// (the specs do), never raise it. A process that imports the libraries
// without starting a budget (a spec running a rule in process) has none.

/** Each hook's budget, in ms: its timeout in settings.json, less a margin. */
export const hookBudgetsMs = Object.freeze({
  'guard-bash': 45_000,
  'build-guard': 30_000,
  'plan-to-issue': 20_000,
  // SessionStart and UserPromptSubmit, 30 s each (Copilot review of #26,
  // seventh round): past it, session-context says the state could not be
  // read in time, before Claude Code would kill it with nothing said.
  'session-context': 15_000,
})

/** Lowers the budget of any hook, for the specs; a higher value is ignored. */
export const budgetVariable = 'LOOP_HOOKS_BUDGET_MS'

/** Below this much time left, no process is worth starting. */
const floorMs = 50

/** The budget ran out: the step it was about to take is in the message. */
export class BudgetExhausted extends Error {
  constructor(step, budgetMs) {
    super(
      `o prazo de ${budgetMs / 1000} s do hook acabou antes de ${step}: o git ou o gh está lento; confira o comando, ou tente de novo`,
    )
    this.name = 'BudgetExhausted'
    this.budgetMs = budgetMs
  }
}

let deadline = Infinity
let budgetMs = null
let heldMs = 0

/**
 * Starts the budget of this run for hook `name`: its entry in hookBudgetsMs,
 * or less when the environment asks for less. Returns the budget in ms.
 */
export function startBudget(name, env = process.env) {
  const own = hookBudgetsMs[name]
  if (own === undefined) throw new Error(`hook sem prazo: ${name}`)
  const lowered = Number(env?.[budgetVariable])
  budgetMs =
    Number.isFinite(lowered) && lowered > 0 ? Math.min(lowered, own) : own
  deadline = Date.now() + budgetMs
  heldMs = 0
  return budgetMs
}

/**
 * Holds back a slice of the budget, at most `ms` and never more than a third
 * of it, for a fallback that must still run once the rest is spent
 * (plan-to-issue marks an accepted plan even when the repository could not
 * be read in time; Copilot review of #26, fifth round). The work before the
 * fallback sees a deadline that much earlier, so the whole run still ends
 * within the budget. Returns the ms held.
 */
export function holdBack(ms) {
  if (budgetMs === null || !Number.isFinite(deadline)) return 0
  const slice = Math.max(0, Math.min(ms, Math.floor(budgetMs / 3)))
  deadline -= slice
  heldMs += slice
  return slice
}

/** Gives back what holdBack kept, and returns what is left of the budget in ms. */
export function releaseHeld() {
  deadline += heldMs
  heldMs = 0
  return remainingMs()
}

/** What is left of the budget, in ms (Infinity when none was started). */
export function remainingMs() {
  return deadline - Date.now()
}

/** Throws BudgetExhausted when the budget is spent, before `step`. */
export function checkBudget(step) {
  if (remainingMs() < floorMs) throw new BudgetExhausted(step, budgetMs)
}

/**
 * The timeout for a process about to start: its own, or what is left of the
 * budget when that is shorter. Throws BudgetExhausted when too little is
 * left to start one.
 */
export function spawnTimeout(ownMs, step) {
  checkBudget(step)
  return Math.max(1, Math.min(ownMs, Math.floor(remainingMs())))
}

/**
 * After a process ended: when it was stopped because the budget ran out, not
 * by its own timeout, throws BudgetExhausted, so the caller does not read a
 * killed process as an answer. A spawnSync result: `error.code` ETIMEDOUT or
 * a signal.
 */
export function afterSpawn(run, ownMs, usedMs, step) {
  const stopped = run?.error?.code === 'ETIMEDOUT' || run?.signal != null
  if (stopped && usedMs < ownMs && remainingMs() < floorMs)
    throw new BudgetExhausted(step, budgetMs)
}
