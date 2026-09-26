import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseWithoutResult } from '../../lead-database-definitions/models/response-without-result'

export function makeResponseWithoutResult(
  overrides: Partial<ResponseWithoutResult> = {},
): ResponseWithoutResult {
  return {
    errors: [],
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    success: true,
    warnings: [],
    ...overrides,
  }
}
