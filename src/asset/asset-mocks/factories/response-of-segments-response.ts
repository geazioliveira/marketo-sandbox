import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSegmentsResponse } from '../../asset-definitions/responses/response-of-segments-response'
import { makeSegmentsResponse } from './segments-response'

export function makeResponseOfSegmentsResponse(
  overrides: Partial<ResponseOfSegmentsResponse> = {},
): ResponseOfSegmentsResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSegmentsResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
