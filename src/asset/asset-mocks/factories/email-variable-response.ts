import { faker } from '@faker-js/faker'
import type { EmailVariableResponse } from '../../asset-definitions/responses/email-variable-response'

export function makeEmailVariableResponse(
  overrides: Partial<EmailVariableResponse> = {},
): EmailVariableResponse {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    value: faker.lorem.word(),
    moduleScope: faker.datatype.boolean(),
    moduleId: faker.lorem.word(),
    ...overrides,
  }
}
