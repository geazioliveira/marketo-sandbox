import { faker } from '@faker-js/faker'
import type { EmailTemplateResponse } from '../../asset-definitions/responses/email-template-response'
import { makeFolder } from './folder'

export function makeEmailTemplateResponse(
  overrides: Partial<EmailTemplateResponse> = {},
): EmailTemplateResponse {
  return {
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    version: faker.helpers.arrayElement([1, 2] as const),
    workspace: 'Default',
    ...overrides,
  }
}
