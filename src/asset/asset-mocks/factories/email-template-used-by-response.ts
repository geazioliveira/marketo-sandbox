import { faker } from '@faker-js/faker'
import type { EmailTemplateUsedByResponse } from '../../asset-definitions/responses/email-template-used-by-response'

export function makeEmailTemplateUsedByResponse(
  overrides: Partial<EmailTemplateUsedByResponse> = {},
): EmailTemplateUsedByResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.lorem.word(),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
