#!/usr/bin/env node
// The formatter of the code generators (#29): reads from stdin a JSON list of
// `{ path, content }`, each path relative to the repository, and prints to
// stdout the list of formatted texts, in the same order. scripts/marketo_codegen.py
// calls it once per generator run, before it deletes, writes or compares
// anything, so generate and --check format the same text and a failure touches
// no file.
//
// Each text is formatted in memory with the Prettier config of its destination
// path, the one `npm run format:check` reads there: an `overrides` entry, a
// .prettierrc or an .editorconfig under src/ applies to generated code as it
// applies to the hand-written one. The API reads no ignore file, and
// requirePragma and the range are forced, so no config makes Prettier return a
// text it did not format.
//
// Prettier is imported from this repository's own node_modules, by path. A bare
// `import('prettier')` climbs to any node_modules above the repository, and a
// worktree without `npm ci` would format with the main checkout's copy.
//
// Exits 0 with the list, or 2 with the reason on stderr: 2 means "could not
// format", never "stale", as in the rest of the generators (ADR 0015).

import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root, 'node_modules', 'prettier', 'index.mjs')

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

// stdout carries the list of texts: a config or plugin that logs writes to stderr instead.
for (const method of ['log', 'info', 'debug']) console[method] = console.error

if (!existsSync(entry))
  fail('Prettier not found at node_modules/prettier: run `npm ci` first.')

let prettier
try {
  prettier = await import(pathToFileURL(entry).href)
} catch (error) {
  fail(`Prettier at node_modules/prettier could not load: ${error.message}`)
}

let input = ''
for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk

let files
try {
  files = JSON.parse(input)
} catch (error) {
  fail(`The formatter expects a JSON list on stdin: ${error.message}`)
}

const formatted = []
for (const { path: relative, content } of files) {
  const filepath = path.join(root, relative)
  try {
    const options =
      (await prettier.resolveConfig(filepath, { editorconfig: true })) ?? {}
    formatted.push(
      await prettier.format(content, {
        ...options,
        filepath,
        requirePragma: false,
        rangeStart: 0,
        rangeEnd: Infinity,
      }),
    )
  } catch (error) {
    fail(`Prettier could not format ${relative}: ${error.message}`)
  }
}
process.stdout.write(JSON.stringify(formatted))
