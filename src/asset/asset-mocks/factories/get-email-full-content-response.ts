import { faker } from '@faker-js/faker'
import type { GetEmailFullContentResponse } from '../../asset-definitions/responses/get-email-full-content-response'

export function makeGetEmailFullContentResponse(
  overrides: Partial<GetEmailFullContentResponse> = {},
): GetEmailFullContentResponse {
  return {
    content: faker.lorem.paragraph(),
    id: faker.number.int({ min: 1, max: 99999 }),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    ...overrides,
  }
}
