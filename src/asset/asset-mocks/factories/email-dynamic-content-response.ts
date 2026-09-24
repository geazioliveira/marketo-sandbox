import { faker } from '@faker-js/faker'
import type { EmailDynamicContentResponse } from '../../asset-definitions/responses/email-dynamic-content-response'
import { makeEmailDynamicContentItem } from './email-dynamic-content-item'

export function makeEmailDynamicContentResponse(
  overrides: Partial<EmailDynamicContentResponse> = {},
): EmailDynamicContentResponse {
  return {
    content: faker.helpers.multiple(() => makeEmailDynamicContentItem(), {
      count: { min: 1, max: 3 },
    }),
    createdAt: faker.date.recent().toISOString(),
    id: faker.number.int({ min: 1, max: 99999 }),
    segmentation: faker.number.int({ min: 1, max: 1000 }),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
