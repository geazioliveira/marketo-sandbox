import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type ExpectStatic, test as base } from 'vitest'
import {
  gateCacheFile,
  gateTtlHours,
  ownerRule,
  readyLabel,
} from '../../scripts/loop-sections.mjs'
import { cleanEnv } from '../support/clean-env'
import {
  type HookRepo,
  hookRepo,
  type HookRepoOptions,
  type HookRun,
  runHook,
  processTimeout,
} from '../support/hooks'

/**
 * The session-context hook (.claude/hooks/session-context.mjs), on
 * SessionStart and UserPromptSubmit. It restricts nothing: it tells the
 * agent where the work stands (the branch, its issue, the gate as its cache
 * says) and, on every prompt, that approval in the chat is not the Approve.
 * These events cannot block, so every failure prints nothing and exits 0.
 */

const test = base.extend<{
  fresh: (options?: HookRepoOptions) => Promise<HookRepo>
  scratch: () => string
}>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  fresh: async ({}, use) => {
    const made: HookRepo[] = []
    await use(async (options = {}) => {
      const repo = await hookRepo(options)
      made.push(repo)
      return repo
    })
    for (const repo of made) repo.remove()
  },
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  scratch: async ({}, use) => {
    const made: string[] = []
    await use(() => {
      const dir = realpathSync.native(
        mkdtempSync(path.join(tmpdir(), 'hooks-spec-')),
      )
      made.push(dir)
      return dir
    })
    for (const dir of made) rmSync(dir, { recursive: true, force: true })
  },
})

vi.setConfig({ testTimeout: processTimeout, maxConcurrency: 12 })

const SESSION = 'sessao-contexto-1'
const BRANCH = 'feature/5-hooks-claude-code'

const REMINDER = `Lembrete do loop: aprovação no chat não é Approve. O Approve é o comentário do dono na issue cuja primeira linha é # Owner Approve; o agente nunca o escreve nem aplica ${readyLabel}.`

const start = (session = SESSION) => ({
  session_id: session,
  transcript_path: '/dev/null',
  hook_event_name: 'SessionStart',
  source: 'startup',
})

const prompt = {
  session_id: SESSION,
  transcript_path: '/dev/null',
  hook_event_name: 'UserPromptSubmit',
  prompt: 'Aprovei a #5, pode começar o Build',
}

const contextOf = (run: HookRun): string =>
  run.json?.hookSpecificOutput?.additionalContext ?? ''

/** The three lines of a SessionStart context: branch, gate, owner rule. */
function linesOf(run: HookRun, expect: ExpectStatic): string[] {
  expect(run.status).toBe(0)
  expect(run.json?.hookSpecificOutput?.hookEventName).toBe('SessionStart')
  const lines = contextOf(run).split('\n')
  expect(lines).toHaveLength(3)
  expect(lines[2]).toBe(ownerRule)
  return lines
}

describe.concurrent('session-context on SessionStart', () => {
  test('on main: nothing in construction', async ({ fresh, expect }) => {
    const repo = await fresh()
    const [branch, gate] = linesOf(
      await repo.run('session-context', start()),
      expect,
    )
    expect(branch).toBe('Em main: nada em construção.')
    expect(gate).toBe(
      'Gate sem cache nesta worktree: rode npm run gate na branch antes de editar.',
    )
    expect(repo.calls()).toEqual([])
  })

  test('on a feature branch with the cache open: the branch, its issue and when the gate ran', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const cache = repo.writeCache()
    const [branch, gate] = linesOf(
      await repo.run('session-context', start()),
      expect,
    )
    expect(branch).toBe(`Branch ${BRANCH} (issue #5).`)
    expect(gate).toBe(`Gate aberto para a #5 (rodado em ${cache.checkedAt}).`)
  })

  test('on another issue branch with its own cache: that branch and that issue, read for that branch', async ({
    fresh,
    expect,
  }) => {
    for (const [branch, issue] of [
      ['feature/8-outra-coisa', 8],
      ['fix/9-uma-falha', 9],
    ] as const) {
      const repo = await fresh({ branch })
      const cache = repo.writeCache()
      const [branchLine, gate] = linesOf(
        await repo.run('session-context', start()),
        expect,
      )
      expect(branchLine).toBe(`Branch ${branch} (issue #${issue}).`)
      expect(gate).toBe(
        `Gate aberto para a #${issue} (rodado em ${cache.checkedAt}).`,
      )
    }
  })

  test('a cache written for #5 does not open the gate on another branch', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: 'feature/8-outra-coisa' })
    const cache = repo.writeCache({ branch: BRANCH, issue: 5 })
    const [, gate] = linesOf(await repo.run('session-context', start()), expect)
    expect(gate).toBe(
      `O cache do gate não é desta branch (rodado em ${cache.checkedAt}): rode npm run gate na branch antes de editar.`,
    )
  })

  test('on claude/x: the branch names no issue', async ({ fresh, expect }) => {
    const repo = await fresh({ branch: 'claude/x' })
    const [branch] = linesOf(await repo.run('session-context', start()), expect)
    expect(branch).toBe(
      'Branch claude/x não nomeia uma issue: o gate a recusa.',
    )
  })

  test('with a plan pending in this session: the gate counts as closed, cache open or not', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH, marker: SESSION })
    const [, bare] = linesOf(await repo.run('session-context', start()), expect)
    expect(bare).toBe(
      'Há um plano aceito nesta sessão e ainda não publicado numa issue: o gate conta como fechado até o plano ser publicado.',
    )
    const cache = repo.writeCache()
    const [, withCache] = linesOf(
      await repo.run('session-context', start()),
      expect,
    )
    expect(withCache).toBe(
      `Há um plano aceito nesta sessão e ainda não publicado numa issue; o gate rodou em ${cache.checkedAt}: o gate conta como fechado até o plano ser publicado.`,
    )
  })

  test('a plan pending in another session does not count for this one', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true, marker: 'outra' })
    const [, gate] = linesOf(await repo.run('session-context', start()), expect)
    expect(gate).toMatch(/^Gate aberto para a #5 /)
  })

  test('each other state of the cache, in pt-BR, with when the gate ran', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH })
    const closed = repo.writeCache({ open: false })
    expect(linesOf(await repo.run('session-context', start()), expect)[1]).toBe(
      `Gate fechado (rodado em ${closed.checkedAt}): rode npm run gate e resolva o que ele aponta.`,
    )

    const unverified = repo.writeCache({ verified: false })
    const unverifiedLine = linesOf(
      await repo.run('session-context', start()),
      expect,
    )[1]
    expect(unverifiedLine).toContain(
      `Gate sem verificação no GitHub (rodado em ${unverified.checkedAt})`,
    )
    expect(unverifiedLine).toContain('pede confirmação')

    const old = new Date(Date.now() - (gateTtlHours + 1) * 36e5).toISOString()
    repo.writeCache({ checkedAt: old })
    expect(linesOf(await repo.run('session-context', start()), expect)[1]).toBe(
      `Gate vencido (rodado em ${old}): o cache vale ${gateTtlHours} h; rode npm run gate na branch antes de editar.`,
    )

    const other = repo.writeCache({ branch: 'feature/6-outra', issue: 6 })
    expect(linesOf(await repo.run('session-context', start()), expect)[1]).toBe(
      `O cache do gate não é desta branch (rodado em ${other.checkedAt}): rode npm run gate na branch antes de editar.`,
    )

    writeFileSync(path.join(repo.gitDir, gateCacheFile), '{ não é json')
    expect(linesOf(await repo.run('session-context', start()), expect)[1]).toBe(
      'Gate sem cache nesta worktree: rode npm run gate na branch antes de editar.',
    )
  })

  test('with HEAD detached', async ({ fresh, expect }) => {
    const repo = await fresh({ detached: true })
    const [branch] = linesOf(await repo.run('session-context', start()), expect)
    expect(branch).toBe(
      'HEAD destacado: nenhuma branch, nenhuma issue; o gate o recusa.',
    )
  })

  test('in a linked worktree: that worktree branch and cache', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh()
    const tree = await repo.addWorktree('arvore', 'feature/8-outra-coisa')
    const run = await repo.run('session-context', { ...start(), cwd: tree.dir })
    const [branch, gate] = linesOf(run, expect)
    expect(branch).toBe('Branch feature/8-outra-coisa (issue #8).')
    expect(gate).toMatch(/^Gate sem cache/)
  })

  test('outside a repository, it prints nothing', async ({
    scratch,
    expect,
  }) => {
    const dir = scratch()
    const run = await runHook(
      'session-context',
      { ...start(), cwd: dir },
      { env: cleanEnv(dir) },
    )
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe('')
  })

  test('in another repository, or one with no origin, it prints nothing', async ({
    fresh,
    expect,
  }) => {
    for (const origin of ['git@github.com:someone/else.git', null]) {
      const repo = await fresh({ branch: BRANCH, cache: true, origin })
      const run = await repo.run('session-context', start())
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
    }
  })
})

describe.concurrent('session-context on UserPromptSubmit', () => {
  test('always prints the reminder, in the project', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    const run = await repo.run('session-context', prompt)
    expect(run.status).toBe(0)
    expect(run.json).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: REMINDER,
      },
    })
    expect(REMINDER.split('\n')).toHaveLength(1)
  })

  test('always prints the reminder, outside a repository and elsewhere too', async ({
    fresh,
    scratch,
    expect,
  }) => {
    const dir = scratch()
    const outside = await runHook(
      'session-context',
      { ...prompt, cwd: dir },
      { env: cleanEnv(dir) },
    )
    expect(contextOf(outside)).toBe(REMINDER)
    const elsewhere = await fresh({
      origin: 'https://github.com/someone/else.git',
    })
    expect(contextOf(await elsewhere.run('session-context', prompt))).toBe(
      REMINDER,
    )
  })
})

describe.concurrent('session-context on errors', () => {
  test('input that is not a JSON object exits 0 and prints nothing', async ({
    fresh,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    for (const input of ['', '{', '"SessionStart"', '[]', 'null']) {
      const run = await repo.run('session-context', input)
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
      expect(run.stderr).toBe('')
    }
  })

  test('git that cannot run exits 0 and prints nothing', async ({
    fresh,
    scratch,
    expect,
  }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    const run = await repo.run('session-context', start(), {
      env: { ...repo.env(), PATH: scratch() },
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe('')
  })

  test('another event, or none, prints nothing', async ({ fresh, expect }) => {
    const repo = await fresh({ branch: BRANCH, cache: true })
    for (const input of [
      { session_id: SESSION, hook_event_name: 'Stop' },
      { session_id: SESSION },
    ]) {
      const run = await repo.run('session-context', input)
      expect(run.status).toBe(0)
      expect(run.stdout).toBe('')
    }
  })
})
