import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
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

// Two cases run the three generators in a row, each under the 30 s timeout of
// generateWith: the test waits longer than all three together (#23).
vi.setConfig({ testTimeout: 120_000 })

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
  const remove = () => rmSync(root, { recursive: true, force: true })
  try {
    fill(root, { prettier, wrapped })
  } catch (error) {
    remove()
    throw error
  }
  return { root, dir: path.join(root, 'repo'), remove }
}

function fill(
  root: string,
  { prettier, wrapped }: { prettier: boolean; wrapped: boolean },
): void {
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
  return generateFrom(at, at.dir, env, generator, ...args)
}

/** The generator run from `cwd`, which may be outside the tree. */
async function generateFrom(
  at: Tree,
  cwd: string,
  env: Record<string, string>,
  generator: Generator,
  ...args: string[]
): Promise<{ status: number | null; out: string }> {
  const run = await exec(
    'python3',
    [
      path.join(at.dir, 'scripts', `generate-marketo-${generator}.py`),
      '--target',
      'identity',
      ...args,
    ],
    {
      cwd,
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

/**
 * A file no generator writes, in every output folder of the identity target.
 * A run that deleted a folder before failing loses it, even where the
 * rewritten output happens to match the committed one byte for byte.
 */
function plantSentinels(at: Tree): void {
  for (const folder of [
    'src/identity/identity-definitions',
    'src/identity/resources',
    'src/identity/identity-mocks',
    'src/mocks',
  ])
    writeFileSync(path.join(at.dir, folder, 'untouched.txt'), 'untouched\n')
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
        expect(run.out).toMatch(/npm ci/)
        expect(run.out).not.toMatch(/stale|current/)
        expect(run.status, run.out).toBe(2)
      }),
  )

  it.each(generators)(
    '%s: a Prettier that is not executable fails on Prettier, never as stale',
    (generator) =>
      withTree({ prettier: false }, async (at) => {
        const bin = path.join(at.dir, 'node_modules', '.bin')
        mkdirSync(bin, { recursive: true })
        writeFileSync(path.join(bin, 'prettier'), '#!/usr/bin/env node\n', {
          mode: 0o644,
        })
        plantSentinels(at)
        const before = snapshot(at)
        for (const args of [['--check'], []]) {
          const run = await generate(at, generator, ...args)
          expect(run.out).toMatch(
            /Prettier at node_modules\/\.bin\/prettier is not executable/,
          )
          expect(run.out).not.toMatch(/Traceback|stale|current/)
          expect(run.status, run.out).toBe(2)
        }
        expect(snapshot(at)).toEqual(before)
      }),
  )

  it.each(generators)(
    '%s: generate without Prettier fails and leaves the output untouched',
    (generator) =>
      withTree({ prettier: false }, async (at) => {
        plantSentinels(at)
        const before = snapshot(at)
        const run = await generate(at, generator)
        expect(run.out).toMatch(/Prettier not found/)
        expect(run.out).toMatch(/npm ci/)
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

  // The wrapped Prettier drops --ignore-path=, so the default ignore files are
  // back: the copied .gitignore (its /.codegen-tmp/ line), or a .prettierignore
  // once that line is gone.
  it.each(
    generators.flatMap((generator) =>
      ['.gitignore', '.prettierignore'].map(
        (file) => [generator, file] as const,
      ),
    ),
  )(
    '%s: a Prettier run that skips files through %s fails loud, never as stale',
    (generator, file) =>
      withTree({ wrapped: true }, async (at) => {
        const gitignore = path.join(at.dir, '.gitignore')
        if (file === '.gitignore') appendFileSync(gitignore, '\n/*\n!/src/\n')
        else {
          writeFileSync(
            gitignore,
            readFileSync(gitignore, 'utf8').replace(/^\/\.codegen-tmp\/$/m, ''),
          )
          writeFileSync(
            path.join(at.dir, '.prettierignore'),
            '/.codegen-tmp/\n',
          )
        }
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

  // A config that makes Prettier process a file without formatting it: the
  // command line beats it (--no-require-pragma, the whole-file range).
  it.each(generators)(
    '%s: a config with requirePragma and a range still formats the output',
    (generator) =>
      withTree({}, async (at) => {
        const rc = path.join(at.dir, '.prettierrc')
        writeFileSync(
          rc,
          JSON.stringify({
            ...JSON.parse(readFileSync(rc, 'utf8')),
            requirePragma: true,
            rangeEnd: 0,
          }),
        )
        const check = await generate(at, generator, '--check')
        expect(check.out).toMatch(/ are current\./)
        expect(check.status, check.out).toBe(0)
        const before = snapshot(at)
        const run = await generate(at, generator)
        expect(run.status, run.out).toBe(0)
        expect(snapshot(at)).toEqual(before)
      }),
  )

  // The experimental CLI formats without the per-file report the guard reads.
  it.each(generators)(
    '%s: a PRETTIER_EXPERIMENTAL_CLI in the environment changes nothing',
    (generator) =>
      withTree({}, async (at) => {
        const run = await generateWith(
          at,
          { PRETTIER_EXPERIMENTAL_CLI: '1' },
          generator,
          '--check',
        )
        expect(run.out).toMatch(/ are current\./)
        expect(run.status, run.out).toBe(0)
      }),
  )

  it('the node in PATH comes before the ones in ~/.nvm', () =>
    withTree({}, async (at) => {
      // cleanEnv moves HOME into the tree: a ~/.nvm whose node always fails.
      const fake = path.join(at.root, 'home', '.nvm', 'versions', 'node')
      mkdirSync(path.join(fake, 'v99.0.0', 'bin'), { recursive: true })
      writeFileSync(
        path.join(fake, 'v99.0.0', 'bin', 'node'),
        '#!/bin/sh\nexit 1\n',
        { mode: 0o755 },
      )
      const run = await generateWith(
        at,
        {
          NODE_BIN: '',
          PATH: [path.dirname(process.execPath), process.env.PATH ?? ''].join(
            path.delimiter,
          ),
        },
        'definitions',
        '--check',
      )
      expect(run.out).toMatch(/ are current\./)
      expect(run.status, run.out).toBe(0)
    }))

  // An area written with --swagger and --area is regenerated only by the same
  // flags, and a document outside the repository leaves no machine path.
  it.each([
    [
      'inside',
      'docs/marketo-swagger-identity.json',
      'docs/marketo-swagger-identity.json',
    ],
    [
      'outside',
      '../marketo-swagger-identity.json',
      '<path to marketo-swagger-identity.json>',
    ],
  ] as const)(
    'a custom area from a document %s the repository names it and its flags',
    (_, swagger, named) =>
      withTree({}, async (at) => {
        cpSync(
          path.join(at.dir, 'docs', 'marketo-swagger-identity.json'),
          path.join(at.root, 'marketo-swagger-identity.json'),
        )
        const run = await generate(
          at,
          'definitions',
          '--swagger',
          swagger,
          '--area',
          'zz-custom',
        )
        expect(run.status, run.out).toBe(0)
        const header = readFileSync(
          path.join(
            at.dir,
            'src/zz-custom/zz-custom-definitions/requests/identity-request.ts',
          ),
          'utf8',
        )
          .split('\n')
          .slice(0, 2)
        expect(header).toEqual([
          `// Code generated by scripts/generate-marketo-definitions.py from ${swagger === '../marketo-swagger-identity.json' ? 'marketo-swagger-identity.json' : swagger}. DO NOT EDIT.`,
          `// Change the generator or the Swagger document, then run \`npm run generate:definitions -- --swagger ${named} --area zz-custom\`.`,
        ])
      }),
  )

  it('docs/ behind a link out of the repository keeps the header', () =>
    withTree({}, async (at) => {
      renameSync(path.join(at.dir, 'docs'), path.join(at.root, 'docs-shared'))
      symlinkSync(path.join(at.root, 'docs-shared'), path.join(at.dir, 'docs'))
      const run = await generate(at, 'definitions', '--check')
      expect(run.out).toMatch(/ are current\./)
      expect(run.status, run.out).toBe(0)
    }))

  it.skipIf(process.platform !== 'darwin')(
    'a document path in another letter case still counts as inside the repository',
    () =>
      withTree({}, async (at) => {
        const upper = at.dir.toUpperCase()
        // Only a case-insensitive disk, the macOS default, has both spellings.
        if (!existsSync(upper)) return
        const run = await generate(
          at,
          'definitions',
          '--swagger',
          path.join(upper, 'docs', 'marketo-swagger-identity.json'),
          '--area',
          'zz-case',
        )
        expect(run.status, run.out).toBe(0)
        const header = readFileSync(
          path.join(
            at.dir,
            'src/zz-case/zz-case-definitions/requests/identity-request.ts',
          ),
          'utf8',
        )
        expect(header).toMatch(
          /^\/\/ Code generated by scripts\/generate-marketo-definitions\.py from docs\/marketo-swagger-identity\.json\./,
        )
      }),
  )

  // Prettier runs with cwd at the root, so a relative node folder has to be
  // made absolute before it goes into PATH.
  it.each([
    ['NODE_BIN', (bin: string) => ({ NODE_BIN: bin, PATH: '/usr/bin:/bin' })],
    [
      'PATH entry',
      (bin: string) => ({ NODE_BIN: '', PATH: `${bin}:/usr/bin:/bin` }),
    ],
  ] as const)('a relative %s is read from the caller cwd', (_, env) =>
    withTree({}, async (at) => {
      mkdirSync(path.join(at.root, 'nb'))
      symlinkSync(process.execPath, path.join(at.root, 'nb', 'node'))
      const run = await generateFrom(
        at,
        at.root,
        env('nb'),
        'definitions',
        '--check',
      )
      expect(run.out).toMatch(/ are current\./)
      expect(run.status, run.out).toBe(0)
    }),
  )

  it('a PRETTIER_ variable in the environment changes nothing', () =>
    withTree({}, async (at) => {
      const run = await generateWith(
        at,
        { PRETTIER_PERF_REPEAT: '1' },
        'definitions',
        '--check',
      )
      expect(run.out).toMatch(/ are current\./)
      expect(run.status, run.out).toBe(0)
    }))

  it.each([
    [
      'a registered area',
      [] as string[],
      'src/identity/identity-definitions',
      'restore it with `git checkout -- src/identity/identity-definitions && git clean -fd -- src/identity/identity-definitions`',
    ],
    [
      'a custom area',
      [
        '--swagger',
        'docs/marketo-swagger-identity.json',
        '--area',
        'zz-broken',
      ],
      'src/zz-broken/zz-broken-definitions',
      'delete it',
    ],
  ] as const)(
    'a Prettier that fails on %s says how to undo the rewrite',
    (_, args, folder, undo) =>
      withTree({}, async (at) => {
        writeFileSync(path.join(at.dir, '.prettierrc'), '{ broken')
        const run = await generate(at, 'definitions', ...args)
        expect(run.status, run.out).toBe(2)
        expect(run.out).toContain(
          `${folder} was rewritten unformatted: run the generator again once Prettier works, or ${undo}.`,
        )
      }),
  )

  it('a NODE_BIN whose node is not executable fails before touching the output', () =>
    withTree({}, async (at) => {
      const bin = path.join(at.root, 'fake-bin')
      mkdirSync(bin)
      writeFileSync(path.join(bin, 'node'), '#!/bin/sh\n', { mode: 0o644 })
      plantSentinels(at)
      const before = snapshot(at)
      for (const args of [['--check'], []]) {
        const run = await generateWith(
          at,
          { NODE_BIN: bin },
          'definitions',
          ...args,
        )
        expect(run.out).toMatch(
          /Node\.js not found in NODE_BIN .*not executable/,
        )
        expect(run.out).not.toMatch(/Traceback|stale|current/)
        expect(run.status, run.out).toBe(2)
      }
      expect(snapshot(at)).toEqual(before)
    }))

  it('a custom area from a document with a space quotes it in the command', () =>
    withTree({}, async (at) => {
      cpSync(
        path.join(at.dir, 'docs', 'marketo-swagger-identity.json'),
        path.join(at.dir, 'docs', 'identity copy.json'),
      )
      const run = await generate(
        at,
        'definitions',
        '--swagger',
        'docs/identity copy.json',
        '--area',
        'zz-spaced',
      )
      expect(run.status, run.out).toBe(0)
      const header = readFileSync(
        path.join(
          at.dir,
          'src/zz-spaced/zz-spaced-definitions/requests/identity-request.ts',
        ),
        'utf8',
      )
        .split('\n')
        .slice(0, 2)
      expect(header[1]).toBe(
        "// Change the generator or the Swagger document, then run `npm run generate:definitions -- --swagger 'docs/identity copy.json' --area zz-spaced`.",
      )
    }))

  it.each(
    generators.flatMap((generator) =>
      [
        ['--check', ['--check']],
        ['generate', []],
      ].map(([label, args]) => [generator, label, args] as const),
    ),
  )(
    '%s %s: a NODE_BIN without node fails before touching the output',
    (generator, _, args) =>
      withTree({}, async (at) => {
        plantSentinels(at)
        const before = snapshot(at)
        const run = await generateWith(
          at,
          { NODE_BIN: at.root },
          generator,
          ...(args as string[]),
        )
        expect(run.out).toMatch(/Node\.js not found/)
        expect(run.out).not.toMatch(/Traceback|stale|current/)
        expect(run.status, run.out).toBe(2)
        expect(snapshot(at)).toEqual(before)
      }),
  )
})

/** The document and the sha256 a `swagger-source.ts` records (#19). */
function recorded(file: string): { document?: string; sha256?: string } {
  const text = readFileSync(file, 'utf8')
  return {
    document: /document: '([^']+)'/.exec(text)?.[1],
    sha256: /sha256: '([0-9a-f]{64})'/.exec(text)?.[1],
  }
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const identityDocument = 'docs/marketo-swagger-identity.json'
const identitySource = 'src/identity/identity-definitions/swagger-source.ts'

/**
 * The tree as a real git repository, committed with or without the
 * project's .gitattributes, then cloned with `core.autocrlf=true`: the
 * checkout a Windows machine makes by default.
 */
async function crlfClone(at: Tree, withRule: boolean): Promise<Tree> {
  const env = cleanEnv(at.root)
  const git = async (cwd: string, ...args: string[]) => {
    const run = await exec('git', args, { cwd, env, timeout: 30_000 })
    expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0)
  }
  rmSync(path.join(at.dir, '.git'), { recursive: true, force: true })
  if (withRule)
    cpSync(
      path.join(projectRoot, '.gitattributes'),
      path.join(at.dir, '.gitattributes'),
    )
  await git(at.dir, 'init', '--quiet')
  await git(at.dir, 'add', '--all')
  await git(
    at.dir,
    '-c',
    'user.name=spec',
    '-c',
    'user.email=spec@example.com',
    'commit',
    '--quiet',
    '--message',
    'tree',
  )
  const clone = path.join(at.root, 'clone')
  await git(
    at.root,
    'clone',
    '--quiet',
    '-c',
    'core.autocrlf=true',
    'repo',
    'clone',
  )
  symlinkSync(
    path.join(projectRoot, 'node_modules'),
    path.join(clone, 'node_modules'),
  )
  return { ...at, dir: clone }
}

describe.concurrent(
  'the Swagger source record, on the identity target (#19)',
  () => {
    it('generate writes the document and the sha256 of its bytes', () =>
      withTree({}, async (at) => {
        const run = await generate(at, 'definitions')
        expect(run.status, run.out).toBe(0)
        expect(recorded(path.join(at.dir, identitySource))).toEqual({
          document: identityDocument,
          sha256: sha256(path.join(at.dir, identityDocument)),
        })
      }))

    it('--check fails on a document changed without regenerating', () =>
      withTree({}, async (at) => {
        appendFileSync(path.join(at.dir, identityDocument), '\n')
        const run = await generate(at, 'definitions', '--check')
        expect(run.out).toContain(`stale or unexpected: ${identitySource}`)
        expect(run.out).toMatch(/1 missing or changed, 0 unexpected/)
        expect(run.status).toBe(1)
      }))

    it('a custom area records the document as its header writes it', () =>
      withTree({}, async (at) => {
        cpSync(
          path.join(at.dir, identityDocument),
          path.join(at.dir, 'docs', 'identity copy.json'),
        )
        const run = await generate(
          at,
          'definitions',
          '--swagger',
          'docs/identity copy.json',
          '--area',
          'zz-recorded',
        )
        expect(run.status, run.out).toBe(0)
        expect(
          recorded(
            path.join(
              at.dir,
              'src/zz-recorded/zz-recorded-definitions/swagger-source.ts',
            ),
          ),
        ).toEqual({
          document: 'docs/identity copy.json',
          sha256: sha256(path.join(at.dir, identityDocument)),
        })
      }))

    it('a core.autocrlf=true checkout keeps the committed bytes and sha256', () =>
      withTree({}, async (at) => {
        const clone = await crlfClone(at, true)
        const document = path.join(clone.dir, identityDocument)
        expect(readFileSync(document, 'utf8')).not.toContain('\r\n')
        const check = await generate(clone, 'definitions', '--check')
        expect(check.status, check.out).toBe(0)
        const run = await generate(clone, 'definitions')
        expect(run.status, run.out).toBe(0)
        expect(recorded(path.join(clone.dir, identitySource)).sha256).toBe(
          sha256(path.join(projectRoot, identityDocument)),
        )
      }))

    it('without the rule, the same checkout writes CRLF and --check fails', () =>
      withTree({}, async (at) => {
        const clone = await crlfClone(at, false)
        expect(
          readFileSync(path.join(clone.dir, identityDocument), 'utf8'),
        ).toContain('\r\n')
        const run = await generate(clone, 'definitions', '--check')
        expect(run.out).toContain(`stale or unexpected: ${identitySource}`)
        expect(run.status).toBe(1)
      }))
  },
)

describe('the Swagger source record of every registered target (#19)', () => {
  interface Registered {
    key: string
    definitions: string
    source: string
  }

  const targets = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        [
          'import json, sys',
          "sys.path.insert(0, 'scripts')",
          'from marketo_codegen import ROOT, TARGETS',
          'print(json.dumps([{"key": t.key, "definitions": t.definitions.relative_to(ROOT).as_posix(), "source": t.source.relative_to(ROOT).as_posix()} for t in TARGETS.values()]))',
        ].join('\n'),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      },
    ),
  ) as Registered[]

  it('lists the five documents', () => {
    expect(targets.map((target) => target.key)).toEqual([
      'asset',
      'data-ingestion',
      'identity',
      'mapi',
      'user',
    ])
  })

  it.each(targets)(
    '$key: the record matches the bytes of $source',
    ({ definitions, source }) => {
      expect(
        recorded(path.join(projectRoot, definitions, 'swagger-source.ts')),
      ).toEqual({
        document: source,
        sha256: sha256(path.join(projectRoot, source)),
      })
    },
  )

  it.each(targets)(
    '$key: $source is out of every line-ending conversion',
    async ({ source }) => {
      const root = mkdtempSync(path.join(tmpdir(), 'codegen-spec-'))
      try {
        const run = await exec('git', ['check-attr', 'text', '--', source], {
          cwd: projectRoot,
          env: cleanEnv(root),
          timeout: 30_000,
        })
        expect(run.status, run.stderr).toBe(0)
        expect(run.stdout.trim()).toBe(`${source}: text: unset`)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})
