import { faker } from '@faker-js/faker'
import type { EmailTemplateContentResponse } from '../../asset-definitions/responses/email-template-content-response'

export function makeEmailTemplateContentResponse(
  overrides: Partial<EmailTemplateContentResponse> = {},
): EmailTemplateContentResponse {
  return {
    content: faker.lorem.paragraph(),
    id: faker.number.int({ min: 1, max: 99999 }),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    ...overrides,
  }
}
