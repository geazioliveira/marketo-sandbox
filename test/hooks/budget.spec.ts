import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type BudgetLib, loadHookLib } from '../support/hooks'

/**
 * The one time budget of a hook's run (.claude/hooks/lib/budget.mjs). A
 * hook Claude Code kills past its timeout lets the tool call through,
 * decided by nobody, so the budget is what turns a slow git or gh into an
 * answer: a mistake here makes a slow read pass in silence, or blocks work
 * that had time left (Copilot review of #42).
 *
 * The budget is module state, so each case loads a fresh copy of the
 * module, and the clock is faked: time passes by setSystemTime, never by
 * waiting.
 */

const t0 = Date.parse('2026-09-28T12:00:00Z')
let budget: BudgetLib

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(t0)
  vi.resetModules()
  budget = await loadHookLib<BudgetLib>('budget')
})

afterEach(() => {
  vi.useRealTimers()
})

const later = (ms: number) => vi.setSystemTime(t0 + ms)

describe('startBudget', () => {
  it('has no deadline before a budget starts', () => {
    expect(budget.remainingMs()).toBe(Infinity)
    expect(() => budget.checkBudget('ler o git')).not.toThrow()
    expect(budget.holdBack(1_000)).toBe(0)
  })

  it('gives each hook its own budget, and refuses a hook without one', () => {
    for (const [name, ms] of Object.entries(budget.hookBudgetsMs))
      expect(budget.startBudget(name, {}), name).toBe(ms)
    expect(() => budget.startBudget('outro', {})).toThrow('hook sem prazo')
  })

  it('lets the environment lower a budget, never raise it', () => {
    const own = budget.hookBudgetsMs['guard-bash']
    const env = (value: string) => ({ [budget.budgetVariable]: value })
    expect(budget.startBudget('guard-bash', env('500'))).toBe(500)
    expect(budget.remainingMs()).toBe(500)
    for (const value of [String(own * 2), '0', '-1', 'x', ''])
      expect(budget.startBudget('guard-bash', env(value)), value).toBe(own)
  })
})

describe('spawnTimeout and checkBudget', () => {
  it('gives a process its own timeout, or what is left when that is shorter', () => {
    budget.startBudget('build-guard', { [budget.budgetVariable]: '10000' })
    expect(budget.spawnTimeout(2_000, 'ler o git')).toBe(2_000)
    later(9_000)
    expect(budget.spawnTimeout(2_000, 'ler o git')).toBe(1_000)
  })

  it('starts no process once the budget is spent, and names the step', () => {
    budget.startBudget('build-guard', { [budget.budgetVariable]: '10000' })
    later(9_960)
    expect(() => budget.spawnTimeout(2_000, 'ler o gh')).toThrow(
      budget.BudgetExhausted,
    )
    expect(() => budget.checkBudget('ler o gh')).toThrow(
      'o prazo de 10 s do hook acabou antes de ler o gh',
    )
  })
})

describe('holdBack and releaseHeld', () => {
  it('keeps a slice for a fallback, at most a third of the budget, and gives it back', () => {
    budget.startBudget('plan-to-issue', { [budget.budgetVariable]: '9000' })
    expect(budget.holdBack(5_000)).toBe(3_000)
    expect(budget.remainingMs()).toBe(6_000)
    later(5_990)
    // The work before the fallback sees the earlier deadline.
    expect(() => budget.checkBudget('ler o repositório')).toThrow(
      budget.BudgetExhausted,
    )
    // The fallback gets the slice back, and still ends within the budget.
    expect(budget.releaseHeld()).toBe(3_010)
    expect(() => budget.checkBudget('gravar o marcador')).not.toThrow()
    expect(budget.releaseHeld()).toBe(3_010)
  })

  it('holds back only what is asked when that is less than a third', () => {
    budget.startBudget('plan-to-issue', { [budget.budgetVariable]: '9000' })
    expect(budget.holdBack(1_000)).toBe(1_000)
    expect(budget.holdBack(-5)).toBe(0)
    expect(budget.remainingMs()).toBe(8_000)
  })
})

describe('afterSpawn', () => {
  const timedOut = { error: { code: 'ETIMEDOUT' } }

  it('tells a process the budget stopped from one that hit its own timeout', () => {
    budget.startBudget('guard-bash', { [budget.budgetVariable]: '1000' })
    later(990)
    // Stopped before its own 2 s, with the budget spent: the budget did it.
    expect(() => budget.afterSpawn(timedOut, 2_000, 990, 'ler o gh')).toThrow(
      budget.BudgetExhausted,
    )
    expect(() =>
      budget.afterSpawn({ signal: 'SIGTERM' }, 2_000, 990, 'ler o gh'),
    ).toThrow(budget.BudgetExhausted)
    // Its own timeout ran out: the caller reads it as that process's failure.
    expect(() =>
      budget.afterSpawn(timedOut, 500, 500, 'ler o gh'),
    ).not.toThrow()
  })

  it('reads a process that ended on its own, or with budget left, as its answer', () => {
    // A fresh module per case: no budget from the cases before.
    expect(budget.remainingMs()).toBe(Infinity)
    budget.startBudget('guard-bash', { [budget.budgetVariable]: '1000' })
    expect(() => budget.afterSpawn({}, 2_000, 10, 'ler o gh')).not.toThrow()
    expect(() => budget.afterSpawn(null, 2_000, 10, 'ler o gh')).not.toThrow()
    // Stopped early while plenty was left: not the budget's doing.
    expect(() =>
      budget.afterSpawn(timedOut, 2_000, 100, 'ler o gh'),
    ).not.toThrow()
    later(990)
    expect(() => budget.afterSpawn({}, 2_000, 990, 'ler o gh')).not.toThrow()
  })
})
