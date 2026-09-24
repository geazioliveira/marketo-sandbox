import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfTokenResponse } from '../../asset-definitions/responses/response-of-token-response'
import { makeTokenResponse } from './token-response'

export function makeResponseOfTokenResponse(
  overrides: Partial<ResponseOfTokenResponse> = {},
): ResponseOfTokenResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeTokenResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
