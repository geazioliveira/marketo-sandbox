import { faker } from '@faker-js/faker'
import type { EmailModuleResponse } from '../../asset-definitions/responses/email-module-response'

export function makeEmailModuleResponse(
  overrides: Partial<EmailModuleResponse> = {},
): EmailModuleResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
