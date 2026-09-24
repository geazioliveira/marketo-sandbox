import { faker } from '@faker-js/faker'
import type { CreateEmailRequest } from '../../asset-definitions/requests/create-email-request'
import { makeFolder } from './folder'

export function makeCreateEmailRequest(
  overrides: Partial<CreateEmailRequest> = {},
): CreateEmailRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    fromEmail: faker.internet.email(),
    fromName: faker.lorem.words({ min: 2, max: 3 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    operational: faker.datatype.boolean(),
    replyEmail: faker.internet.email(),
    subject: faker.lorem.words({ min: 2, max: 5 }),
    template: faker.number.int({ min: 1, max: 1000 }),
    textOnly: faker.datatype.boolean(),
    autoCopyToText: faker.datatype.boolean(),
    ...overrides,
  }
}
