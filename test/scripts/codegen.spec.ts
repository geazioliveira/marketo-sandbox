import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanEnv } from '../support/clean-env'
import { exec, projectRoot } from '../support/temp-repo'

/**
 * The generators in scripts/*.py, run the way `npm run check:*` and
 * `npm run generate:*` run them, against the smallest copy of this repository
 * that one target needs: the identity document (6 KB), its committed output,
 * the shared mocks, the Prettier config and the .gitignore (#7).
 *
 * The scripts are copied, never linked: ROOT is the resolved parent of
 * scripts/, so a link would point the generator back at this repository and
 * `generate` would rewrite it. node_modules is linked, and only when the case
 * wants Prettier present. An empty .git marks the tree as a project root, so
 * Prettier never climbs out of it looking for an .editorconfig.
 */

vi.setConfig({ testTimeout: 60_000 })

const generators = ['definitions', 'resources', 'factories'] as const
type Generator = (typeof generators)[number]

/** What the tree holds besides scripts/*.py, relative to the repository. */
const copied = [
  '.prettierrc',
  '.gitignore',
  'docs/marketo-swagger-identity.json',
  'src/identity',
  'src/mocks',
]

interface Tree {
  root: string
  dir: string
  remove: () => void
}

function tree({
  prettier = true,
  wrapped = false,
}: { prettier?: boolean; wrapped?: boolean } = {}): Tree {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'codegen-spec-')))
  const dir = path.join(root, 'repo')
  mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  mkdirSync(path.join(dir, '.git'))
  for (const file of readdirSync(path.join(projectRoot, 'scripts')))
    if (file.endsWith('.py'))
      cpSync(
        path.join(projectRoot, 'scripts', file),
        path.join(dir, 'scripts', file),
      )
  for (const file of copied) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    cpSync(path.join(projectRoot, file), path.join(dir, file), {
      recursive: true,
    })
  }
  if (wrapped) {
    // The regression the guard exists for: Prettier run without --ignore-path.
    const bin = path.join(dir, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    const cli = path.join(
      projectRoot,
      'node_modules',
      'prettier',
      'bin',
      'prettier.cjs',
    )
    writeFileSync(
      path.join(bin, 'prettier'),
      `#!/usr/bin/env node
const args = process.argv.slice(2)
const at = args.indexOf('--ignore-path')
if (at >= 0) args.splice(at, 2)
const eq = args.findIndex((arg) => arg.startsWith('--ignore-path='))
if (eq >= 0) args.splice(eq, 1)
const run = require('node:child_process').spawnSync(process.execPath, [${JSON.stringify(cli)}, ...args], { stdio: 'inherit' })
process.exit(run.status ?? 1)
`,
      { mode: 0o755 },
    )
  } else if (prettier)
    symlinkSync(
      path.join(projectRoot, 'node_modules'),
      path.join(dir, 'node_modules'),
    )
  return {
    root,
    dir,
    remove: () => rmSync(root, { recursive: true, force: true }),
  }
}

async function generate(
  at: Tree,
  generator: Generator,
  ...args: string[]
): Promise<{ status: number | null; out: string }> {
  return generateWith(at, {}, generator, ...args)
}

async function generateWith(
  at: Tree,
  env: Record<string, string>,
  generator: Generator,
  ...args: string[]
): Promise<{ status: number | null; out: string }> {
  const run = await exec(
    'python3',
    [
      `scripts/generate-marketo-${generator}.py`,
      '--target',
      'identity',
      ...args,
    ],
    {
      cwd: at.dir,
      // NODE_BIN pins the node that runs Prettier: cleanEnv moves HOME, and
      // with it the ~/.nvm the generator would otherwise search.
      env: cleanEnv(at.root, {
        extra: {
          NODE_BIN: path.dirname(process.execPath),
          PYTHONDONTWRITEBYTECODE: '1',
          FORCE_COLOR: '1',
          ...env,
        },
      }),
      timeout: 30_000,
    },
  )
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

/** Every file under src/, relative path to content. */
function snapshot(at: Tree): Record<string, string> {
  const src = path.join(at.dir, 'src')
  const files: Record<string, string> = {}
  for (const entry of readdirSync(src, {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name)
      files[path.relative(src, file)] = readFileSync(file, 'utf8')
    }
  return files
}

async function withTree(
  options: { prettier?: boolean; wrapped?: boolean },
  body: (at: Tree) => Promise<void>,
): Promise<void> {
  const at = tree(options)
  try {
    await body(at)
  } finally {
    at.remove()
  }
}

describe.concurrent('the generators, on the identity target (#7)', () => {
  it.each(generators)('%s: --check passes the committed output', (generator) =>
    withTree({}, async (at) => {
      const run = await generate(at, generator, '--check')
      expect(run.out).toMatch(/ are current\./)
      expect(run.out).not.toMatch(/stale/)
      expect(run.status, run.out).toBe(0)
    }),
  )

  it('generate rewrites the committed output byte for byte', () =>
    withTree({}, async (at) => {
      const before = snapshot(at)
      for (const generator of generators) {
        const run = await generate(at, generator)
        expect(run.status, run.out).toBe(0)
      }
      expect(snapshot(at)).toEqual(before)
    }))

  it('generate opens every file it writes with the generated header', () =>
    withTree({}, async (at) => {
      // The one hand-written file the identity tree holds.
      const handWritten = ['identity/identity.module.ts']
      for (const generator of generators) {
        const run = await generate(at, generator)
        expect(run.status, run.out).toBe(0)
      }
      const written = Object.entries(snapshot(at)).filter(
        ([file]) => !handWritten.includes(file),
      )
      expect(written.length).toBeGreaterThan(0)
      for (const [file, content] of written)
        expect(content, file).toMatch(
          // src/mocks is shared by every area, so its header names no document.
          file.startsWith('mocks/')
            ? /^\/\/ Code generated by scripts\/generate-marketo-factories\.py\. DO NOT EDIT\.\n\/\/ Change the generator, then run `npm run generate:factories`\.\n\n/
            : /^\/\/ Code generated by scripts\/generate-marketo-(definitions|resources|factories)\.py from docs\/marketo-swagger-identity\.json\. DO NOT EDIT\.\n\/\/ Change the generator or the Swagger document, then run `npm run generate:\1`\.\n\n/,
        )
    }))

  it.each(generators)(
    '%s: --check without Prettier fails on Prettier, never as stale',
    (generator) =>
      withTree({ prettier: false }, async (at) => {
        const run = await generate(at, generator, '--check')
        expect(run.out).toMatch(
          /Prettier not found at node_modules\/\.bin\/prettier/,
        )
        expect(run.out).not.toMatch(/stale|current/)
        expect(run.status, run.out).toBe(2)
      }),
  )

  it.each(generators)(
    '%s: generate without Prettier fails and leaves the output untouched',
    (generator) =>
      withTree({ prettier: false }, async (at) => {
        const before = snapshot(at)
        const run = await generate(at, generator)
        expect(run.out).toMatch(/Prettier not found/)
        expect(run.status, run.out).toBe(2)
        expect(snapshot(at)).toEqual(before)
      }),
  )

  // Prettier 3 reads .gitignore and .prettierignore by default and skips, in
  // silence, any path they match, even one passed on the command line. The
  // checker stages its copy inside the tree, so an ignore rule over that copy
  // left it unformatted and every file looked stale: #6 took .gitignore out of
  // the way, and .prettierignore still could. `/*` then `!/src/` matches every
  // top-level path but src/, wherever the checker stages its copy.
  it.each(
    generators.flatMap((generator) =>
      ['.gitignore', '.prettierignore'].map(
        (file) => [generator, file] as const,
      ),
    ),
  )('%s: --check formats its copy even when %s matches it', (generator, file) =>
    withTree({}, async (at) => {
      appendFileSync(path.join(at.dir, file), '\n/*\n!/src/\n')
      const run = await generate(at, generator, '--check')
      expect(run.out).not.toMatch(/stale/)
      expect(run.status, run.out).toBe(0)
    }),
  )

  it('--check fails on a hand-edited generated file and names it', () =>
    withTree({}, async (at) => {
      const file = 'src/identity/identity-mocks/factories/identity-request.ts'
      appendFileSync(path.join(at.dir, file), '// editado à mão\n')
      const run = await generate(at, 'factories', '--check')
      expect(run.out).toContain(`stale or unexpected: ${file}`)
      expect(run.out).toMatch(/1 missing or changed, 0 unexpected/)
      expect(run.status).toBe(1)
    }))

  it('--check fails on a file the generator does not write', () =>
    withTree({}, async (at) => {
      const file = 'src/identity/identity-definitions/models/extra.ts'
      mkdirSync(path.dirname(path.join(at.dir, file)), { recursive: true })
      writeFileSync(path.join(at.dir, file), 'export const extra = 1\n')
      const run = await generate(at, 'definitions', '--check')
      expect(run.out).toContain(`stale or unexpected: ${file}`)
      expect(run.out).toMatch(/0 missing or changed, 1 unexpected/)
      expect(run.status).toBe(1)
    }))

  it.each(generators)(
    '%s: a Prettier run that skips files fails loud, never as stale',
    (generator) =>
      withTree({ wrapped: true }, async (at) => {
        appendFileSync(path.join(at.dir, '.gitignore'), '\n/*\n!/src/\n')
        const run = await generate(at, generator, '--check')
        expect(run.out).toMatch(/Prettier did not process \d+ of \d+ files/)
        expect(run.out).not.toMatch(/stale|current/)
        expect(run.status, run.out).toBe(2)
      }),
  )

  it.each(generators)(
    '%s: generate formats src/ even when .prettierignore matches it',
    (generator) =>
      withTree({}, async (at) => {
        writeFileSync(path.join(at.dir, '.prettierignore'), 'src/\n')
        const before = snapshot(at)
        const run = await generate(at, generator)
        expect(run.status, run.out).toBe(0)
        expect(snapshot(at)).toEqual(before)
      }),
  )

  it.each(
    generators.flatMap((generator) =>
      ['--check', ''].map((mode) => [generator, mode] as const),
    ),
  )(
    '%s %s: a NODE_BIN without node fails before touching the output',
    (generator, mode) =>
      withTree({}, async (at) => {
        const before = snapshot(at)
        const run = await generateWith(
          at,
          { NODE_BIN: at.root },
          generator,
          ...(mode ? [mode] : []),
        )
        expect(run.out).toMatch(/Node\.js not found/)
        expect(run.out).not.toMatch(/Traceback|stale|current/)
        expect(run.status, run.out).toBe(2)
        expect(snapshot(at)).toEqual(before)
      }),
  )
})
