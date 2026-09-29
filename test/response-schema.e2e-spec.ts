import { AddressInfo } from 'node:net'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { seedMockData } from '../src/mocks'
import { swaggerDocuments } from './support/marketo-routes'
import {
  DocumentedOperation,
  SchemaError,
  operationsOf,
  responseSchema,
  schemaErrors,
  successResponse,
} from './support/response-schema'

/**
 * Every operation of the five Marketo Swagger documents answers what its
 * document declares for the lowest 2xx: that status, a body that conforms to
 * the schema, sent as JSON, and every declared header (#24).
 *
 * test/marketo-api.e2e-spec.ts holds the routes to the documents, and
 * test/route-order.e2e-spec.ts each request to its own handler. Neither reads
 * a response: before #24 an array schema came back as `{}`, a string response
 * came back empty, and no declared header was sent.
 */

/**
 * The places where a document contradicts itself: the definition lists a
 * required property it never defines, so no response can have it. Each one
 * is excused where it applies, and nowhere else.
 */
const selfContradictions = [
  { definition: 'ObjectMetaData', missing: 'status' },
  { definition: 'GetLandingPageFullContentResponse', missing: 'status' },
]

/** The operations those contradictions excuse, measured on `e5b013c`. */
const excusedOperations = [
  'GET /rest/asset/v1/landingPage/{id}/fullContent.json',
  'GET /rest/v1/companies/describe.json',
  'GET /rest/v1/customobjects.json',
  'GET /rest/v1/customobjects/schema.json',
  'GET /rest/v1/customobjects/schema/{apiName}/describe.json',
  'GET /rest/v1/customobjects/{customObjectName}/describe.json',
  'GET /rest/v1/namedaccounts/describe.json',
  'GET /rest/v1/opportunities/describe.json',
  'GET /rest/v1/opportunities/roles/describe.json',
  'GET /rest/v1/salespersons/describe.json',
]

function nameOf({ method, path }: DocumentedOperation): string {
  return `${method.toUpperCase()} ${path}`
}

function excused(error: SchemaError): boolean {
  return selfContradictions.some(
    ({ definition, missing }) =>
      error.definition === definition && error.missing === missing,
  )
}

interface Outcome {
  problems: string[]
  excused: SchemaError[]
}

async function answer(
  origin: string,
  documented: DocumentedOperation,
): Promise<Outcome> {
  const url = documented.path.replace(/\{[^}]+\}/g, '1')
  const agent = request(origin)
  const call = agent[documented.method as 'get'](url)
  const response = await (documented.method === 'get' ? call : call.send({}))

  const { status, response: declared } = successResponse(documented)
  const problems: string[] = []
  if (response.status !== status) {
    problems.push(`status ${response.status}, the document says ${status}`)
  }

  let excusedErrors: SchemaError[] = []
  const schema = responseSchema(declared)
  if (schema) {
    const contentType = String(response.headers['content-type'] ?? '')
    if (!contentType.startsWith('application/json')) {
      problems.push(`content-type "${contentType}", not application/json`)
    } else if (response.text === '') {
      problems.push('no body, and the document declares one')
    } else {
      const errors = schemaErrors(
        documented.document,
        schema,
        JSON.parse(response.text),
      )
      excusedErrors = errors.filter(excused)
      problems.push(
        ...errors
          .filter((error) => !excused(error))
          .map((error) => `${error.at}: ${error.message}`),
      )
    }
  } else if (response.text !== '') {
    problems.push('a body, and the document declares none')
  }

  for (const header of Object.keys(declared.headers ?? {})) {
    if (!response.headers[header.toLowerCase()]) {
      problems.push(`no ${header} header`)
    }
  }
  return { problems, excused: excusedErrors }
}

describe('responses against the documents (e2e)', () => {
  const operations = swaggerDocuments().flatMap(operationsOf)
  const outcomes = new Map<string, Outcome>()
  let app: INestApplication

  beforeAll(async () => {
    seedMockData(24)
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleFixture.createNestApplication()
    // One listener for all 388 requests. Handed the bare server, supertest
    // would listen on a new ephemeral port for each request, and on this
    // many one of them can land on a port another local process holds on
    // 127.0.0.1, which answers in its place.
    await app.listen(0, '127.0.0.1')
    const { port } = app.getHttpServer().address() as AddressInfo
    const origin = `http://127.0.0.1:${port}`

    for (const documented of operations) {
      outcomes.set(nameOf(documented), await answer(origin, documented))
    }
  })

  afterAll(async () => {
    await app.close()
  })

  it('reads the 388 operations of the five documents', () => {
    expect(operations).toHaveLength(388)
    expect(outcomes.size).toBe(388)
  })

  it.each(operations.map(nameOf))(
    '%s answers the documented status, body and headers',
    (name) => {
      expect(outcomes.get(name)?.problems).toEqual([])
    },
  )

  it('excuses only the self-contradictions, on the operations they reach', () => {
    const reached = [...outcomes]
      .filter(([, outcome]) => outcome.excused.length > 0)
      .map(([name]) => name)
      .sort()
    expect(reached).toEqual(excusedOperations)

    const used = selfContradictions.filter((contradiction) =>
      [...outcomes.values()].some((outcome) =>
        outcome.excused.some(
          (error) =>
            error.definition === contradiction.definition &&
            error.missing === contradiction.missing,
        ),
      ),
    )
    expect(used).toEqual(selfContradictions)
  })
})
