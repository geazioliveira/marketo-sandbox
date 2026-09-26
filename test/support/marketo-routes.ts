import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { INestApplication } from '@nestjs/common'

/**
 * The routes the Marketo Swagger documents in docs/ declare, and the routes
 * the app's Express router registers, for the e2e tests that hold one to the
 * other (#6, #8).
 */

const docs = path.resolve(__dirname, '..', '..', 'docs')

// Every method OpenAPI allows, not only those the generators handle: an
// operation they skip, such as a HEAD, still has to have a route.
const httpMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]

interface SwaggerDocument {
  paths: Record<string, Record<string, unknown>>
}

/** The file names of the Marketo Swagger documents in docs/, sorted. */
export function swaggerDocuments(): string[] {
  return readdirSync(docs)
    .filter((file) => /^marketo-swagger-.+\.json$/.test(file))
    .sort()
}

/** Each operation of a document as `METHOD /path/:param`, the way Express names a route. */
export function documentedRoutes(file: string): string[] {
  const document = JSON.parse(
    readFileSync(path.join(docs, file), 'utf8'),
  ) as SwaggerDocument
  return Object.entries(document.paths).flatMap(([route, item]) =>
    Object.keys(item)
      .filter((method) => httpMethods.includes(method))
      .map(
        (method) =>
          `${method.toUpperCase()} ${route.replace(/\{([^}]+)\}/g, ':$1')}`,
      ),
  )
}

/** A layer of the Express router. Only a route layer has a `route`. */
export interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean> }
  match?: (path: string) => boolean
}

export interface RouteLayer extends RouterLayer {
  route: { path: string; methods: Record<string, boolean> }
}

/**
 * The route layers of the app's Express router, in the order Express tries
 * them. This reads the router's internal stack (router 2.2.0, locked with
 * Express 5.2.1): a version that moves it fails the tests, it does not pass
 * them on nothing.
 */
export function routeLayers(app: INestApplication): RouteLayer[] {
  const { stack } = app.getHttpAdapter().getInstance().router as {
    stack: RouterLayer[]
  }
  return stack.filter((layer): layer is RouteLayer => Boolean(layer.route))
}
