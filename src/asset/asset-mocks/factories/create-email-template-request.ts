import { faker } from '@faker-js/faker'
import type { CreateEmailTemplateRequest } from '../../asset-definitions/requests/create-email-template-request'
import { makeFolder } from './folder'

export function makeCreateEmailTemplateRequest(
  overrides: Partial<CreateEmailTemplateRequest> = {},
): CreateEmailTemplateRequest {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    folder: makeFolder(),
    description: faker.lorem.sentence(),
    content: faker.lorem.paragraph(),
    ...overrides,
  }
}
