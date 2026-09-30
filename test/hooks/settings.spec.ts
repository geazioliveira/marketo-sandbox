import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadHookLib } from '../support/hooks'
import { projectRoot } from '../support/temp-repo'

// .claude/settings.json is what turns the hooks on (#5). A hook left out of
// it, or run without the wrapper, protects nothing: Claude Code lets the
// action through when a hook does not start, and only run.sh turns a
// missing script into exit 2.

interface HookCommand {
  type: string
  command: string
  timeout?: number
}
interface HookGroup {
  matcher?: string
  hooks: HookCommand[]
}
interface Settings {
  hooks: Record<string, HookGroup[]>
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] }
}

const settings = JSON.parse(
  readFileSync(path.join(projectRoot, '.claude', 'settings.json'), 'utf8'),
) as Settings

const hookNames = readdirSync(path.join(projectRoot, '.claude', 'hooks'))
  .filter((file) => file.endsWith('.mjs'))
  .map((file) => file.replace(/\.mjs$/, ''))
  .sort()

const wrapper = (name: string) =>
  `sh "$CLAUDE_PROJECT_DIR/.claude/hooks/run.sh" ${name}`

/** Every (event, matcher, hook name) the settings register. */
const registered = Object.entries(settings.hooks).flatMap(([event, groups]) =>
  groups.flatMap((group) =>
    group.hooks.map((hook) => ({
      event,
      matcher: group.matcher ?? null,
      hook,
      name: /run\.sh" ([a-z-]+)$/.exec(hook.command)?.[1] ?? null,
    })),
  ),
)

describe('.claude/settings.json (#5)', () => {
  it('registers every hook script, each through run.sh and with a timeout', () => {
    expect(hookNames).toEqual([
      'build-guard',
      'guard-bash',
      'plan-to-issue',
      'session-context',
    ])
    for (const entry of registered) {
      expect(entry.hook.type).toBe('command')
      expect(entry.name).not.toBeNull()
      expect(entry.hook.command).toBe(wrapper(entry.name ?? ''))
      expect(entry.hook.timeout).toBeGreaterThan(0)
    }
    expect([...new Set(registered.map((entry) => entry.name))].sort()).toEqual(
      hookNames,
    )
  })

  it.each([
    ['PreToolUse', 'Bash|Monitor|mcp__terminal__run_in_terminal', 'guard-bash'],
    ['PreToolUse', 'Edit|Write|NotebookEdit', 'build-guard'],
    [
      'PostToolUse',
      'ExitPlanMode|Bash|Monitor|mcp__terminal__run_in_terminal',
      'plan-to-issue',
    ],
    ['SessionStart', null, 'session-context'],
    ['UserPromptSubmit', null, 'session-context'],
  ])('runs on %s, matching %s, the %s hook', (event, matcher, name) => {
    expect(registered).toContainEqual(
      expect.objectContaining({ event, matcher, name }),
    )
  })

  it('registers nothing else', () => {
    expect(registered).toHaveLength(5)
  })

  it('publishes a plan through every tool guard-bash guards (Copilot review of #26)', () => {
    const matcherOf = (name: string) =>
      new Set(
        registered
          .filter((entry) => entry.name === name)
          .flatMap((entry) => (entry.matcher ?? '').split('|')),
      )
    const guarded = matcherOf('guard-bash')
    const publishing = matcherOf('plan-to-issue')
    for (const tool of guarded) expect(publishing).toContain(tool)
  })

  it('gives each hook that reads git or GitHub a budget well below its timeout (Copilot review of #26)', async () => {
    // Claude Code kills a hook past its timeout and runs the tool call
    // undecided; the budget ends the run first, with room for Node to start
    // and for the answer to be printed.
    const budget = await loadHookLib<{
      hookBudgetsMs: Record<string, number>
    }>('budget')
    const margin = 10_000
    const names = Object.keys(budget.hookBudgetsMs).sort()
    // session-context too (seventh round): it reads git on SessionStart,
    // and a killed hook says nothing at all.
    expect(names).toEqual([
      'build-guard',
      'guard-bash',
      'plan-to-issue',
      'session-context',
    ])
    for (const name of names) {
      const timeouts = registered
        .filter((entry) => entry.name === name)
        .map((entry) => entry.hook.timeout ?? 0)
      expect(timeouts.length).toBeGreaterThan(0)
      for (const timeout of timeouts)
        expect(budget.hookBudgetsMs[name] + margin).toBeLessThanOrEqual(
          timeout * 1000,
        )
    }
  })

  it('lets the environment lower a budget, never raise it past its timeout (Copilot review of #26)', async () => {
    // The margin above holds only for the budget shipped: a variable left in
    // Claude Code's environment must not stretch a run past the kill.
    const budget = await loadHookLib<{
      budgetVariable: string
      hookBudgetsMs: Record<string, number>
      startBudget: (name: string, env: Record<string, string>) => number
    }>('budget')
    for (const [name, own] of Object.entries(budget.hookBudgetsMs)) {
      const run = (value: string) =>
        budget.startBudget(name, { [budget.budgetVariable]: value })
      expect(run(String(own * 10))).toBe(own)
      expect(run('1000')).toBe(1000)
      for (const unread of ['0', '-5', 'x', '']) expect(run(unread)).toBe(own)
    }
  })

  it('never lets a git timeout from the environment stretch a run past its budget (#59)', async () => {
    // LOOP_HOOKS_GIT_TIMEOUT_MS may raise a git's own timeout, as the gh one
    // may: each process still gets what is left of the budget at most, so
    // the margin above holds whatever the variable says.
    const budget = await loadHookLib<{
      gitTimeoutVariable: string
      gitTimeoutMs: (env: Record<string, string>) => number
      hookBudgetsMs: Record<string, number>
      startBudget: (name: string, env: Record<string, string>) => number
      spawnTimeout: (ownMs: number, step: string) => number
    }>('budget')
    const own = budget.gitTimeoutMs({
      [budget.gitTimeoutVariable]: String(10 * 60_000),
    })
    expect(own).toBe(10 * 60_000)
    for (const [name, ms] of Object.entries(budget.hookBudgetsMs)) {
      budget.startBudget(name, {})
      expect(budget.spawnTimeout(own, 'ler o git'), name).toBeLessThanOrEqual(
        ms,
      )
    }
  })

  it('holds back at most a third of a budget for a fallback, and gives it back (Copilot review of #26, fifth round)', async () => {
    // plan-to-issue marks an accepted plan even when the repository could
    // not be read in time: the slice held back is what that write runs in,
    // and the run as a whole still ends within the budget.
    const budget = await loadHookLib<{
      budgetVariable: string
      startBudget: (name: string, env: Record<string, string>) => number
      holdBack: (ms: number) => number
      releaseHeld: () => number
      remainingMs: () => number
    }>('budget')
    const env = { [budget.budgetVariable]: '3000' }
    budget.startBudget('plan-to-issue', env)
    expect(budget.holdBack(5000)).toBe(1000)
    expect(budget.remainingMs()).toBeLessThanOrEqual(2000)
    expect(budget.releaseHeld()).toBeGreaterThan(2000)
    expect(budget.releaseHeld()).toBeLessThanOrEqual(3000)
    budget.startBudget('plan-to-issue', {})
    expect(budget.holdBack(5000)).toBe(5000)
    expect(budget.remainingMs()).toBeLessThanOrEqual(15_000)
    // A new run starts with nothing held.
    budget.startBudget('plan-to-issue', env)
    expect(budget.releaseHeld()).toBeLessThanOrEqual(3000)
  })

  it('denies what the plan of #5 denies, and allows nothing', () => {
    expect(settings.permissions?.allow ?? []).toEqual([])
    expect(settings.permissions?.deny).toEqual([
      'mcp__ccd_pr__set_auto_merge',
      'Bash(gh pr merge *--admin*)',
      'Edit(//**/.claude/settings.local.json)',
      'Edit(//**/loop-gate.json)',
      'Edit(//**/loop-plan-pending-*.json)',
    ])
  })

  it('asks before the browser and computer-use tools', () => {
    const ask = settings.permissions?.ask ?? []
    expect(ask).toContain('mcp__computer-use')
    expect(ask.some((rule) => /browser/i.test(rule))).toBe(true)
    expect(ask.some((rule) => /chrome/i.test(rule))).toBe(true)
  })
})
