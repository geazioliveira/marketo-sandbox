/** Where the mock listens by default: loopback only, on the NestJS port. */
export const defaultHost = '127.0.0.1'
export const defaultPort = 3000

export interface ListenAddress {
  host: string
  port: number
}

/**
 * The address the server listens on, from HOST and PORT. The mock is a
 * loopback service for development and tests, so it binds 127.0.0.1 unless
 * HOST says otherwise; HOST=0.0.0.0 opens it to other machines.
 *
 * An empty or blank variable counts as unset: `listen(port, '')` would bind
 * every interface.
 */
export function listenAddress(env: NodeJS.ProcessEnv): ListenAddress {
  const host = env.HOST?.trim() || defaultHost
  const port = env.PORT?.trim()
  return { host, port: port ? Number(port) : defaultPort }
}
