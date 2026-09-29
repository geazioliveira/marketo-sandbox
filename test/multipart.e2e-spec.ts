import { AddressInfo } from 'node:net'
import { INestApplication } from '@nestjs/common'
import { ModulesContainer } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { MockInstance } from 'vitest'
import { AppModule } from '../src/app.module'
import { swaggerDocuments } from './support/marketo-routes'
import {
  DocumentedOperation,
  consumesOf,
  definition,
  operationsOf,
  successResponse,
} from './support/response-schema'

/**
 * A `multipart/form-data` request reaches its handler with every part, the
 * files as files (#24). The generated controllers read the parts with
 * `@Body(...)`, and without a multipart parser the body was `undefined`.
 *
 * The operations come from the documents: the parts of each are its
 * `formData` parameters, or the properties of its `in: body` schema. A part
 * is a file when the document says so, with `type: file` or, in the asset
 * documents, a description that calls it a multipart file.
 */

interface Part {
  name: string
  file: boolean
  text: string
}

function partsOf({ document, operation }: DocumentedOperation): Part[] {
  return (operation.parameters ?? []).flatMap((parameter): Part[] => {
    if (parameter.in === 'formData') {
      return [
        {
          name: parameter.name,
          file: parameter.type === 'file',
          text: `${parameter.name} sent by the test`,
        },
      ]
    }
    if (parameter.in === 'body' && parameter.schema?.$ref) {
      const { schema } = definition(document, parameter.schema.$ref)
      return Object.entries(schema.properties ?? {}).map(
        ([name, property]) => ({
          name,
          file: /multipart file/i.test(property.description ?? ''),
          text: property.$ref
            ? JSON.stringify({ id: 7, type: 'Folder' })
            : `${name} sent by the test`,
        }),
      )
    }
    return []
  })
}

function nameOf({ method, path }: DocumentedOperation): string {
  return `${method.toUpperCase()} ${path}`
}

/** Whether a handler argument is the part as it was sent. */
function isPart(value: unknown, part: Part): boolean {
  if (!part.file) {
    return value === part.text
  }
  const file = value as { originalname?: string; buffer?: Buffer } | undefined
  return (
    file?.originalname === `${part.name}.txt` &&
    Buffer.isBuffer(file.buffer) &&
    file.buffer.toString('utf8') === part.text
  )
}

/** Whether the handler received the part, as an argument or in the body. */
function received(args: unknown[], part: Part): boolean {
  return args.some(
    (argument) =>
      isPart(argument, part) ||
      (typeof argument === 'object' &&
        argument !== null &&
        isPart((argument as Record<string, unknown>)[part.name], part)),
  )
}

/**
 * A spy on the service method of every provider that has one by this name.
 * An operationId is unique in its document, and a request reaches only one
 * of them.
 */
function spyOnHandler(
  app: INestApplication,
  operationId: string,
): MockInstance[] {
  const spies: MockInstance[] = []
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.providers.values()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined
      if (instance && typeof instance[operationId] === 'function') {
        spies.push(vi.spyOn(instance as never, operationId as never))
      }
    }
  }
  return spies
}

function callsOf(spies: MockInstance[]): unknown[][] {
  return spies.flatMap((spy) => spy.mock.calls as unknown[][])
}

describe('multipart requests (e2e)', () => {
  const multipart = swaggerDocuments()
    .flatMap(operationsOf)
    .filter((documented) =>
      consumesOf(documented).includes('multipart/form-data'),
    )
  let app: INestApplication
  let origin: string

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleFixture.createNestApplication()
    await app.listen(0, '127.0.0.1')
    const { port } = app.getHttpServer().address() as AddressInfo
    origin = `http://127.0.0.1:${port}`
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  it('finds the 11 operations that consume multipart/form-data', () => {
    expect(multipart.map(nameOf)).toHaveLength(11)
    expect(
      multipart.filter((documented) => partsOf(documented).length > 0),
    ).toHaveLength(9)
  })

  it.each(multipart.map((documented) => [nameOf(documented), documented]))(
    '%s hands every part to its handler',
    async (_name, documented) => {
      const parts = partsOf(documented)
      const spies = spyOnHandler(app, documented.operation.operationId)
      expect(spies.length).toBeGreaterThan(0)

      let call = request(origin).post(
        documented.path.replace(/\{[^}]+\}/g, '1'),
      )
      for (const part of parts) {
        call = part.file
          ? call.attach(part.name, Buffer.from(part.text), `${part.name}.txt`)
          : call.field(part.name, part.text)
      }
      if (parts.length === 0) {
        // Still a multipart request, with a part the operation does not declare.
        call = call.field('unused', 'sent by the test')
      }
      const response = await call

      expect(response.status).toBe(successResponse(documented).status)
      const calls = callsOf(spies)
      expect(calls).toHaveLength(1)
      expect(
        parts
          .filter((part) => !received(calls[0], part))
          .map((part) => part.name),
      ).toEqual([])
    },
  )

  it('POST /bulk/v1/leads.json hands the CSV to its handler as a file', async () => {
    const [spy] = spyOnHandler(app, 'importLeadUsingPOST')
    const csv = 'email,firstName\nlead@example.com,Lead\n'

    await request(origin)
      .post('/bulk/v1/leads.json?format=csv')
      .attach('file', Buffer.from(csv), 'leads.csv')
      .expect(200)

    const file = spy.mock.calls[0][1] as {
      originalname: string
      mimetype: string
      buffer: Buffer
    }
    expect(file.originalname).toBe('leads.csv')
    expect(file.mimetype).toBe('text/csv')
    expect(file.buffer.toString('utf8')).toBe(csv)
  })

  it('a malformed multipart body answers 400 and never reaches the handler', async () => {
    const [spy] = spyOnHandler(app, 'importLeadUsingPOST')

    await request(origin)
      .post('/bulk/v1/leads.json?format=csv')
      .set('Content-Type', 'multipart/form-data; boundary=missing')
      .send('--missing\r\nContent-Disposition: form-data; name="file"')
      .expect(400)

    expect(spy).not.toHaveBeenCalled()
  })

  it('a urlencoded formData request still reaches its handler', async () => {
    const [spy] = spyOnHandler(app, 'addSmartListRuleUsingPOST')

    await request(origin)
      .post('/rest/asset/v1/smartList/1/rules.json')
      .type('form')
      .send({ ruleId: '7', index: '2' })
      .expect(200)

    expect(spy.mock.calls[0]).toEqual(expect.arrayContaining(['7', '2']))
  })

  it('a JSON request still reaches its handler', async () => {
    const [spy] = spyOnHandler(app, 'createSnippetUsingPOST')
    const body = { name: 'snippet', folder: { id: 7, type: 'Folder' } }

    await request(origin)
      .post('/rest/asset/v1/snippets.json')
      .send(body)
      .expect(200)

    expect(spy.mock.calls[0]).toEqual([body])
  })
})
