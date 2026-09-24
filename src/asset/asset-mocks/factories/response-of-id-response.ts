import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfIdResponse } from '../../asset-definitions/responses/response-of-id-response'
import { makeIdResponse } from './id-response'

export function makeResponseOfIdResponse(
  overrides: Partial<ResponseOfIdResponse> = {},
): ResponseOfIdResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeIdResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
