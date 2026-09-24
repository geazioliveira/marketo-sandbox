import { faker } from '@faker-js/faker'
import type { UpdateEmailFullContentResponse } from '../../asset-definitions/responses/update-email-full-content-response'

export function makeUpdateEmailFullContentResponse(
  overrides: Partial<UpdateEmailFullContentResponse> = {},
): UpdateEmailFullContentResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
