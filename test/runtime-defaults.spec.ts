import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { defaultHost, defaultPort, listenAddress } from '../src/listen-address'

// By default nothing leaves the machine and the server listens on loopback
// (#9). The listen address is tested through listenAddress; the telemetry
// guard is static: it reads package.json and every file under src/. The
// install is covered too: package.json opts out of @scarf/scarf (#20).

const root = path.resolve(__dirname, '..')
const read = (file: string): string =>
  readFileSync(path.join(root, file), 'utf8')

const telemetryPackage = '@nestjs/observe'
const importsTelemetry = (source: string): boolean =>
  /['"]@nestjs\/observe(?:\/[^'"]*)?['"]/.test(source)

const sourceFiles = readdirSync(path.join(root, 'src'), {
  recursive: true,
  encoding: 'utf8',
})
  .filter((file) => file.endsWith('.ts'))
  .map((file) => path.join('src', file))

describe('listen address', () => {
  it('defaults to 127.0.0.1 and port 3000', () => {
    expect(defaultHost).toBe('127.0.0.1')
    expect(defaultPort).toBe(3000)
    expect(listenAddress({})).toEqual({ host: '127.0.0.1', port: 3000 })
  })

  it('takes HOST and PORT from the environment', () => {
    expect(listenAddress({ HOST: '0.0.0.0', PORT: '4311' })).toEqual({
      host: '0.0.0.0',
      port: 4311,
    })
    expect(listenAddress({ HOST: '::1' }).host).toBe('::1')
    expect(listenAddress({ PORT: '0' }).port).toBe(0)
  })

  it('treats an empty or blank HOST or PORT as unset', () => {
    // listen(port, '') binds every interface.
    for (const blank of ['', '  '])
      expect(listenAddress({ HOST: blank, PORT: blank })).toEqual({
        host: '127.0.0.1',
        port: 3000,
      })
  })

  it('is the address src/main.ts listens on', () => {
    const main = read('src/main.ts')
    expect(main).toContain('listenAddress(process.env)')
    expect(main).toMatch(/app\.listen\(\s*port\s*,\s*host\s*\)/)
  })
})

describe('no telemetry by default', () => {
  it(`${telemetryPackage} is not a dependency`, () => {
    const manifest = JSON.parse(read('package.json')) as Record<
      string,
      Record<string, string> | undefined
    >
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ])
      expect(Object.keys(manifest[field] ?? {}), field).not.toContain(
        telemetryPackage,
      )
  })

  it('@scarf/scarf is opted out of its install event', () => {
    // swagger-ui-dist pulls in @scarf/scarf, whose postinstall POSTs to
    // scarf.sh on every npm ci unless the root package.json opts out (#20).
    const manifest = JSON.parse(read('package.json')) as {
      scarfSettings?: { enabled?: unknown }
    }
    expect(manifest.scarfSettings?.enabled).toBe(false)
  })

  it(`no file under src/ imports ${telemetryPackage}`, () => {
    expect(sourceFiles).toContain(path.join('src', 'main.ts'))
    expect(sourceFiles.filter((file) => importsTelemetry(read(file)))).toEqual(
      [],
    )
  })

  it('the import matcher sees every form of import', () => {
    expect(importsTelemetry(`import { x } from '@nestjs/observe'`)).toBe(true)
    expect(importsTelemetry(`await import("@nestjs/observe/dist/x")`)).toBe(
      true,
    )
    expect(importsTelemetry(`require('@nestjs/observe')`)).toBe(true)
    expect(importsTelemetry(`import { x } from '@nestjs/observer'`)).toBe(false)
  })
})
