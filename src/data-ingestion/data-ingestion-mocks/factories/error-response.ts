import { faker } from '@faker-js/faker'
import type { ErrorResponse } from '../../data-ingestion-definitions/responses/error-response'

export function makeErrorResponse(
  overrides: Partial<ErrorResponse> = {},
): ErrorResponse {
  return {
    error_code: faker.lorem.word(),
    message: faker.lorem.sentence(),
    ...overrides,
  }
}
