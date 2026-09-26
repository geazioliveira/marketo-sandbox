import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types'
import { AppModule } from './../src/app.module'

describe('Marketo API mock (e2e smoke)', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  it('GET /rest/asset/v1/folders.json answers with the Marketo envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/rest/asset/v1/folders.json')
      .expect(200)

    expect(response.body.success).toBe(true)
    expect(typeof response.body.requestId).toBe('string')
    expect(Array.isArray(response.body.result)).toBe(true)
  })

  it('GET / is not a route', () => {
    return request(app.getHttpServer()).get('/').expect(404)
  })

  afterEach(async () => {
    await app.close()
  })
})
