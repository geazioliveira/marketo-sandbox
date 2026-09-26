import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base } from 'vitest'
import { hooksDir, spawnWith, processTimeout } from '../support/hooks'

/**
 * The wrapper settings.json calls (.claude/hooks/run.sh). Claude Code lets a
 * tool call through when a hook cannot start, so the wrapper exists to turn
 * "cannot start" into exit 2, which blocks. Each case runs it with /bin/sh,
 * as settings.json does.
 */

const runSh = path.join(hooksDir, 'run.sh')

/** A probe hook: prints its argv, stdin and cwd as JSON, and exits 3. */
const probe = `let input = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) input += chunk
process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() }))
process.exit(3)
`

/**
 * A copy of run.sh in a temp dir whose name has a space, beside a probe
 * hook: the wrapper must find scripts next to itself, wherever it lives and
 * however the path is spelled.
 */
const test = base.extend<{ copy: { dir: string; runSh: string } }>({
  // oxlint-disable-next-line no-empty-pattern -- vitest reads fixture dependencies from this pattern
  copy: async ({}, use) => {
    const root = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), 'run sh ')),
    )
    const dir = path.join(root, 'hooks dir')
    mkdirSync(dir)
    copyFileSync(runSh, path.join(dir, 'run.sh'))
    writeFileSync(path.join(dir, 'probe.mjs'), probe)
    await use({ dir, runSh: path.join(dir, 'run.sh') })
    rmSync(root, { recursive: true, force: true })
  },
})

vi.setConfig({ testTimeout: processTimeout })

describe.concurrent('.claude/hooks/run.sh', () => {
  test('is committed as a POSIX sh script, executable', ({ expect }) => {
    expect(readFileSync(runSh, 'utf8').startsWith('#!/bin/sh\n')).toBe(true)
    expect(statSync(runSh).mode & 0o111).toBe(0o111)
  })

  test('exits 2 and says so when the named script is missing', async ({
    expect,
  }) => {
    const run = await spawnWith('/bin/sh', [runSh, 'nao-existe'])
    expect(run.status).toBe(2)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe(
      `hooks do loop: nao-existe ausente em ${hooksDir}\n`,
    )
  })

  test('exits 2 when called with no script name', async ({ expect }) => {
    const run = await spawnWith('/bin/sh', [runSh])
    expect(run.status).toBe(2)
    expect(run.stderr).toMatch(/^hooks do loop: {2}ausente em /)
  })

  test('exits 2 for an empty name, even with a script called .mjs', async ({
    expect,
    copy,
  }) => {
    writeFileSync(path.join(copy.dir, '.mjs'), 'process.exit(0)\n')
    const run = await spawnWith('/bin/sh', [copy.runSh, ''])
    expect(run.status).toBe(2)
  })

  test('exits 2 for a name that is a directory, not a script', async ({
    expect,
    copy,
  }) => {
    mkdirSync(path.join(copy.dir, 'pasta.mjs'))
    const run = await spawnWith('/bin/sh', [copy.runSh, 'pasta'])
    expect(run.status).toBe(2)
    expect(run.stderr).toMatch(/pasta ausente/)
  })

  test('runs the script beside it with node, passing stdin, and keeps its exit status', async ({
    expect,
    copy,
  }) => {
    const elsewhere = realpathSync.native(tmpdir())
    const run = await spawnWith('/bin/sh', [copy.runSh, 'probe'], {
      input: '{"tool_name":"Bash"}',
      cwd: elsewhere,
    })
    expect(run.status).toBe(3)
    expect(JSON.parse(run.stdout)).toEqual({
      args: [],
      input: '{"tool_name":"Bash"}',
      cwd: elsewhere,
    })
    expect(run.stderr).toBe('')
  })

  test('finds the script through a relative path, and not beside a symlink', async ({
    expect,
    copy,
  }) => {
    const parent = path.dirname(copy.dir)
    const relative = await spawnWith(
      '/bin/sh',
      [path.join('hooks dir', 'run.sh'), 'probe'],
      { cwd: parent, input: 'x' },
    )
    expect(relative.status).toBe(3)
    const link = path.join(parent, 'link.sh')
    symlinkSync(copy.runSh, link)
    const linked = await spawnWith('/bin/sh', [link, 'probe'])
    // A symlink is read from its own directory, not the target's: there the
    // probe is missing, and the wrapper refuses rather than run something
    // else.
    expect(linked.status).toBe(2)
    expect(linked.stderr).toMatch(/probe ausente/)
  })

  test('ignores CDPATH when finding its own directory', async ({
    expect,
    copy,
  }) => {
    const run = await spawnWith('/bin/sh', [copy.runSh, 'probe'], {
      env: { ...process.env, CDPATH: '/' },
      input: '',
    })
    expect(run.status).toBe(3)
    expect(run.stdout.startsWith('{')).toBe(true)
  })

  test('exits 2 and says so when node is not on PATH', async ({
    expect,
    copy,
  }) => {
    // Only dirname on PATH: the wrapper still finds itself, but no node.
    const bin = path.join(path.dirname(copy.dir), 'bin')
    mkdirSync(bin)
    symlinkSync('/usr/bin/dirname', path.join(bin, 'dirname'))
    const run = await spawnWith('/bin/sh', [copy.runSh, 'probe'], {
      env: { PATH: bin, HOME: path.dirname(copy.dir) },
    })
    expect(run.status).toBe(2)
    expect(run.stderr).toBe('hooks do loop: node ausente\n')
  })
})
