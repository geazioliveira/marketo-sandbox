import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
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
    ['PostToolUse', 'ExitPlanMode|Bash', 'plan-to-issue'],
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
