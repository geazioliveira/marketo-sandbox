import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSmartListResponse } from '../../asset-definitions/responses/response-of-smart-list-response'
import { makeSmartListResponse } from './smart-list-response'

export function makeResponseOfSmartListResponse(
  overrides: Partial<ResponseOfSmartListResponse> = {},
): ResponseOfSmartListResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartListResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
