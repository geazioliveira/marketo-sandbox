import { faker } from '@faker-js/faker'
import type { IdResponse } from '../../asset-definitions/responses/id-response'

export function makeIdResponse(
  overrides: Partial<IdResponse> = {},
): IdResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
