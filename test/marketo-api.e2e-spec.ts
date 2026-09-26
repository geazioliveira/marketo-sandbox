import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { App } from 'supertest/types'
import { AppModule } from '../src/app.module'

/**
 * The five Marketo Swagger documents in docs/, held to the routes the app
 * registers. The generators emit one handler per operation
 * (scripts/generate-marketo-resources.py), but only a running app shows that
 * every area was generated and wired into AppModule.
 *
 * A registered route is not proof that a request reaches its own handler: a
 * literal route declared after a `:param` route is shadowed by it (#8).
 */

const root = path.resolve(__dirname, '..')
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

/** Operations per document, measured on the copies pinned in #6. */
const operationsPerDocument = {
  'marketo-swagger-asset.json': 220,
  'marketo-swagger-data-ingestion.json': 7,
  'marketo-swagger-identity.json': 2,
  'marketo-swagger-mapi.json': 147,
  'marketo-swagger-user.json': 12,
}

interface SwaggerDocument {
  paths: Record<string, Record<string, unknown>>
}

interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean> }
}

/** Each operation as `METHOD /path/:param`, the way Express names a route. */
function documentedRoutes(file: string): string[] {
  const document = JSON.parse(
    readFileSync(path.join(root, 'docs', file), 'utf8'),
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

function registeredRoutes(app: INestApplication): string[] {
  const { stack } = app.getHttpAdapter().getInstance().router as {
    stack: RouterLayer[]
  }
  return stack.flatMap(({ route }) =>
    route
      ? Object.keys(route.methods).map(
          (method) => `${method.toUpperCase()} ${route.path}`,
        )
      : [],
  )
}

function duplicates(routes: string[]): string[] {
  return routes.filter((route, index) => routes.indexOf(route) !== index)
}

describe('Marketo API mock (e2e)', () => {
  let app: INestApplication<App>

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('routes', () => {
    const documents = readdirSync(path.join(root, 'docs'))
      .filter((file) => /^marketo-swagger-.+\.json$/.test(file))
      .sort()
    const documented = documents.flatMap(documentedRoutes)

    it('reads the five documents in docs/, 388 operations in all', () => {
      expect(
        Object.fromEntries(
          documents.map((file) => [file, documentedRoutes(file).length]),
        ),
      ).toEqual(operationsPerDocument)
      expect(documented).toHaveLength(388)
    })

    it('finds no method and path declared twice across the documents', () => {
      expect(duplicates(documented)).toEqual([])
    })

    it('registers a route for every documented operation', () => {
      const registered = new Set(registeredRoutes(app))
      expect(documented.filter((route) => !registered.has(route))).toEqual([])
    })

    it('registers no method and path twice', () => {
      expect(duplicates(registeredRoutes(app))).toEqual([])
    })

    it('registers nothing outside the documents', () => {
      const known = new Set(documented)
      expect(
        registeredRoutes(app).filter((route) => !known.has(route)),
      ).toEqual([])
    })
  })

  describe('one request per area', () => {
    it('asset: a GET answers the Marketo envelope', async () => {
      const response = await request(app.getHttpServer())
        .get('/rest/asset/v1/folders.json')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        errors: [],
        warnings: [],
      })
      expect(response.body.requestId).toEqual(expect.any(String))
    })

    it('asset: a POST answers 200, as the Swagger declares, not the Nest default 201', async () => {
      await request(app.getHttpServer())
        .post('/rest/asset/v1/folders.json')
        .send({ name: 'Mock', parent: { id: 1, type: 'Folder' } })
        .expect(200)
    })

    it('lead database: GET /rest/v1/leads.json answers the envelope', async () => {
      const response = await request(app.getHttpServer())
        .get('/rest/v1/leads.json')
        .query({ filterType: 'id', filterValues: '1' })
        .expect(200)

      expect(response.body).toMatchObject({ success: true })
    })

    it('user management: GET allusers.json answers a list of users', async () => {
      const response = await request(app.getHttpServer())
        .get('/userservice/management/v1/users/allusers.json')
        .expect(200)

      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ emailAddress: expect.any(String) }),
        ]),
      )
    })

    it.each(['get', 'post'] as const)(
      'identity: %s /identity/oauth/token answers a bearer token with 200',
      async (method) => {
        const response = await request(app.getHttpServer())
          [method]('/identity/oauth/token')
          .query({
            grant_type: 'client_credentials',
            client_id: 'mock-client',
            client_secret: 'mock-secret',
          })
          .expect(200)

        expect(response.body).toMatchObject({
          access_token: expect.any(String),
          expires_in: expect.any(Number),
          token_type: 'bearer',
        })
      },
    )

    it('data ingestion: a POST answers 202 with an empty body', async () => {
      const response = await request(app.getHttpServer())
        .post('/subscriptions/123-ABC-456/persons')
        .set('X-Mkto-User-Token', 'mock-token')
        .send({ persons: [{ email: 'mock@example.com' }] })
        .expect(202)

      expect(response.text).toBe('')
    })
  })
})
