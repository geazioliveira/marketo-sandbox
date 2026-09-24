import { faker } from '@faker-js/faker'
import type { EmailContentResponse } from '../../asset-definitions/responses/email-content-response'

export function makeEmailContentResponse(
  overrides: Partial<EmailContentResponse> = {},
): EmailContentResponse {
  return {
    contentType: faker.lorem.paragraph(),
    htmlId: faker.lorem.paragraph(),
    index: faker.number.int({ min: 1, max: 1000 }),
    isLocked: faker.datatype.boolean(),
    parentHtmlId: faker.lorem.paragraph(),
    value: {},
    ...overrides,
  }
}
