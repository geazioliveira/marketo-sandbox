import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { EmailsService } from '../src/asset/resources/emails/emails.service'

/**
 * Request bodies up to the limit Marketo documents (#25). Marketo syncs up to
 * 300 leads per call and answers 413 only when the payload passes 1 MB
 * (Adobe Experience League, "Leads" and "Error Codes"). A 300-lead batch with
 * real fields passes the 100 KiB default of the Express body parsers.
 */

const kib = 1024
const mib = 1024 * kib

/** One lead with the fields a real sync carries, about 600 bytes. */
const lead = (i: number) => ({
  email: `lead${i}@example.com`,
  firstName: `Firstname${i}`,
  lastName: `Lastname${i}`,
  company: `Example Corporation ${i}`,
  title: 'Senior Marketing Operations Manager',
  phone: `+1 555 010 ${String(i).padStart(4, '0')}`,
  address: `${i} Market Street, Suite ${i}`,
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94105',
  country: 'United States',
  leadSource: 'Webinar',
  website: `https://www${i}.example.com/landing/page`,
  notes: 'x'.repeat(200),
})

const batch = Array.from({ length: 300 }, (_, i) => lead(i))
const syncLeads = JSON.stringify({ action: 'createOrUpdate', input: batch })
const syncPersons = JSON.stringify({
  priority: 'normal',
  partitionName: 'Default',
  dedupeFields: { dedupeField1: 'email' },
  input: batch,
})
const formOf = (bytes: number) => `content=${'a'.repeat(bytes - 8)}`
const jsonOf = (bytes: number) =>
  JSON.stringify({ input: [{ notes: 'a'.repeat(bytes - 20) }] })

const sizeOf = (body: string) => Buffer.byteLength(body)

describe('request body limit (e2e, #25)', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      logger: false,
    })
    await app.init()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  it('the bodies sit on the right side of each limit', () => {
    for (const body of [syncLeads, syncPersons, formOf(101 * kib)]) {
      expect(sizeOf(body)).toBeGreaterThan(100 * kib)
      expect(sizeOf(body)).toBeLessThan(mib)
    }
    expect(sizeOf(jsonOf(mib + kib))).toBeGreaterThan(mib)
    expect(sizeOf(formOf(mib + kib))).toBeGreaterThan(mib)
  })

  it('accepts a 300-lead sync above 100 KiB', () => {
    return request(app.getHttpServer())
      .post('/rest/v1/leads.json')
      .set('content-type', 'application/json')
      .send(syncLeads)
      .expect(200)
  })

  it('accepts the same 300 records as a Data Ingestion persons sync', () => {
    return request(app.getHttpServer())
      .post('/subscriptions/123-ABC-456/persons')
      .set('content-type', 'application/json')
      .set('X-Mkto-User-Token', 'token')
      .send(syncPersons)
      .expect(202)
  })

  it('reads an urlencoded asset body above 100 KiB whole, as Nest parses a form', async () => {
    const update = vi.spyOn(
      app.get(EmailsService),
      'updateEmailContentUsingPOST',
    )
    const form = `${formOf(101 * kib)}&nested[key]=value`

    await request(app.getHttpServer())
      .post('/rest/asset/v1/email/1/content.json')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send(form)
      .expect(200)

    // extended: true, Nest's default, still reads brackets as an object.
    const [, body] = update.mock.calls[0] as unknown as [
      unknown,
      { content: string; nested: unknown },
    ]
    expect(body.content).toHaveLength(101 * kib - 8)
    expect(body.nested).toEqual({ key: 'value' })
  })

  it('answers 413 to a JSON body above 1 MiB, as Marketo does', () => {
    return request(app.getHttpServer())
      .post('/rest/v1/leads.json')
      .set('content-type', 'application/json')
      .send(jsonOf(mib + kib))
      .expect(413)
  })

  it('answers 413 to an urlencoded body above 1 MiB, as Marketo does', () => {
    return request(app.getHttpServer())
      .post('/rest/asset/v1/email/1/content.json')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send(formOf(mib + kib))
      .expect(413)
  })
})
