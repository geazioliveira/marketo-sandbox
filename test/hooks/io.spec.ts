import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import {
  type Decision,
  hooksDir,
  type IoLib,
  loadHookLib,
  spawnWith,
  setupTimeout,
  processTimeout,
} from '../support/hooks'

/**
 * The hooks' input and output (.claude/hooks/lib/io.mjs). Every hook's
 * decision passes through combine, resolve and preToolUseOutput, so a slip
 * here would turn every deny of every hook into a silent pass.
 */

let io: IoLib

vi.setConfig({ testTimeout: processTimeout })

beforeAll(async () => {
  io = await loadHookLib<IoLib>('io')
}, setupTimeout)

const stream = (...chunks: (string | Buffer)[]) => Readable.from(chunks)

describe('readInput', () => {
  it('parses a JSON object read whole from the stream', async () => {
    expect(await io.readInput(stream('{"tool_name":', '"Bash"}'))).toEqual({
      tool_name: 'Bash',
    })
  })

  it('decodes a multi-byte character split across two chunks', async () => {
    const bytes = Buffer.from('{"prompt":"aprovação"}')
    const cut = bytes.indexOf(Buffer.from('ç')) + 1
    expect(
      await io.readInput(stream(bytes.subarray(0, cut), bytes.subarray(cut))),
    ).toEqual({ prompt: 'aprovação' })
  })

  it.each([
    ['empty input', ''],
    ['text that is not JSON', 'gh issue view 5'],
    ['a truncated object', '{"tool_name": "Bash"'],
    ['JSON null', 'null'],
    ['an array', '[{"tool_name":"Bash"}]'],
    ['a string', '"Bash"'],
    ['a number', '42'],
  ])('returns null for %s', async (_label, text) => {
    expect(await io.readInput(stream(text))).toBeNull()
  })

  it('returns null when the stream fails', async () => {
    const broken = new Readable({
      read() {
        this.destroy(new Error('EIO'))
      },
    })
    expect(await io.readInput(broken)).toBeNull()
  })

  it('reads process.stdin by default, in a real process', async () => {
    const url = pathToFileURL(path.join(hooksDir, 'lib', 'io.mjs')).href
    const run = await spawnWith(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { readInput } from ${JSON.stringify(url)}; process.stdout.write(JSON.stringify(await readInput()))`,
      ],
      { input: '{"session_id":"abc","cwd":"/tmp"}' },
    )
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({ session_id: 'abc', cwd: '/tmp' })
  })
})

describe('decisions', () => {
  it('builds pass, deny and ask', () => {
    expect(io.pass()).toEqual({ decision: 'pass' })
    expect(io.deny('não')).toEqual({ decision: 'deny', reason: 'não' })
    expect(io.ask('confira')).toEqual({
      decision: 'ask',
      reason: 'confira',
      critical: false,
    })
    expect(io.ask('confira', { critical: true })).toEqual({
      decision: 'ask',
      reason: 'confira',
      critical: true,
    })
  })
})

describe('combine', () => {
  it('passes with nothing to combine, or only passes and gaps', () => {
    expect(io.combine([])).toEqual({ decision: 'pass' })
    expect(io.combine([io.pass(), null, undefined, io.pass()])).toEqual({
      decision: 'pass',
    })
  })

  it('ranks deny over critical ask over ask over pass', () => {
    const plain = io.ask('a')
    const critical = io.ask('c', { critical: true })
    const refused = io.deny('d')
    expect(io.combine([io.pass(), plain])).toEqual(io.ask('a'))
    expect(io.combine([plain, critical, io.pass()])).toEqual(
      io.ask('c', { critical: true }),
    )
    expect(io.combine([critical, refused, plain])).toEqual(io.deny('d'))
  })

  it('joins the reasons of the winning level in order, with a space', () => {
    expect(
      io.combine([
        io.deny('primeiro.'),
        io.ask('perdida.'),
        io.deny('segundo.'),
      ]),
    ).toEqual(io.deny('primeiro. segundo.'))
  })

  it('says a reason repeated by two commands once, and skips empty ones', () => {
    expect(
      io.combine([io.deny('igual.'), io.deny(''), io.deny('igual.')]),
    ).toEqual(io.deny('igual.'))
  })

  it('treats a malformed decision as a deny, never as a pass', () => {
    const combined = io.combine([io.pass(), { decision: 'allow', reason: 'x' }])
    expect(combined.decision).toBe('deny')
    expect(combined.reason).toMatch(/decisão desconhecida/)
  })
})

describe('resolve', () => {
  const critical = (): Decision =>
    io.ask('confira antes do merge.', { critical: true })

  it.each(['bypassPermissions', 'dontAsk', 'auto'])(
    'turns a critical ask into a deny in %s, saying why',
    (mode) => {
      expect(io.autonomousModes).toContain(mode)
      expect(io.resolve(critical(), mode)).toEqual(
        io.deny(
          `confira antes do merge. Em ${mode}, a confirmação vira negação: faça isso fora desse modo.`,
        ),
      )
    },
  )

  it.each(['default', 'acceptEdits', 'plan', undefined])(
    'keeps a critical ask an ask in %s',
    (mode) => {
      expect(io.resolve(critical(), mode)).toEqual(critical())
    },
  )

  it('keeps a plain ask, a deny and a pass as they are, in any mode', () => {
    for (const mode of ['bypassPermissions', 'auto', 'default']) {
      expect(io.resolve(io.ask('confira'), mode)).toEqual(io.ask('confira'))
      expect(io.resolve(io.deny('não'), mode)).toEqual(io.deny('não'))
      expect(io.resolve(io.pass(), mode)).toEqual(io.pass())
    }
  })
})

describe('preToolUseOutput', () => {
  const parsed = (decision: unknown) =>
    JSON.parse(io.preToolUseOutput(decision)) as {
      hookSpecificOutput: Record<string, string>
    }

  it('prints nothing for a pass', () => {
    expect(io.preToolUseOutput(io.pass())).toBe('')
  })

  it('prints a deny with the reason behind the hook tag', () => {
    expect(parsed(io.deny('commit em main.'))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${io.hookTag} commit em main.`,
      },
    })
    expect(io.hookTag).toBe('[hooks do loop, #5]')
  })

  it('prints an ask, critical or not, as an ask', () => {
    expect(parsed(io.ask('confira.')).hookSpecificOutput).toMatchObject({
      permissionDecision: 'ask',
      permissionDecisionReason: `${io.hookTag} confira.`,
    })
    expect(
      parsed(io.ask('confira.', { critical: true })).hookSpecificOutput
        .permissionDecision,
    ).toBe('ask')
  })

  it('never prints allow: anything that is not a pass prints a deny', () => {
    for (const decision of [
      { decision: 'allow' },
      { decision: 'approve', reason: 'x' },
      {},
    ]) {
      const output = parsed(decision).hookSpecificOutput
      expect(output.permissionDecision).toBe('deny')
      expect(io.preToolUseOutput(decision)).not.toMatch(/"allow"/)
    }
  })

  it('prints the tag alone when a decision has no reason', () => {
    expect(
      parsed({ decision: 'deny' }).hookSpecificOutput.permissionDecisionReason,
    ).toBe(io.hookTag)
  })
})

describe('contextOutput', () => {
  it('wraps the text as the event additionalContext', () => {
    expect(
      JSON.parse(io.contextOutput('SessionStart', 'Branch x (issue #5).')),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Branch x (issue #5).',
      },
    })
  })
})
