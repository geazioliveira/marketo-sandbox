import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfStaticListResponse } from '../../asset-definitions/responses/response-of-static-list-response'
import { makeStaticListResponse } from './static-list-response'

export function makeResponseOfStaticListResponse(
  overrides: Partial<ResponseOfStaticListResponse> = {},
): ResponseOfStaticListResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeStaticListResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
