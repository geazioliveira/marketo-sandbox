import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * An environment for a child git or gate process that nothing on the machine
 * running the tests leaks into.
 *
 * GIT_* would point git at another repository (a hook exports GIT_DIR), GH_*
 * at another host or token, and GITHUB_* would make a run inside Actions look
 * like CI mode to the gate. The user's global and system git config are
 * replaced too: a global `commit.gpgsign` or `init.defaultBranch` would change
 * what the temporary repositories look like.
 */
export function cleanEnv(
  root: string,
  { bin, extra = {} }: { bin?: string; extra?: Record<string, string> } = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env))
    if (!/^(GIT|GH|GITHUB)_/.test(key)) env[key] = value

  const home = path.join(root, 'home')
  mkdirSync(home, { recursive: true })
  const globalConfig = path.join(root, 'gitconfig')
  writeFileSync(globalConfig, '', { flag: 'a' })

  env.HOME = home
  env.XDG_CONFIG_HOME = path.join(home, '.config')
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = globalConfig
  if (bin !== undefined)
    env.PATH = [bin, process.env.PATH ?? ''].join(path.delimiter)
  return { ...env, ...extra }
}
