import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfEmailContentResponse } from '../../asset-definitions/responses/response-of-email-content-response'
import { makeEmailContentResponse } from './email-content-response'

export function makeResponseOfEmailContentResponse(
  overrides: Partial<ResponseOfEmailContentResponse> = {},
): ResponseOfEmailContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
