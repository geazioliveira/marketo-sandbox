import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfLpFormResponse } from '../../asset-definitions/responses/response-of-lp-form-response'
import { makeLpFormResponse } from './lp-form-response'

export function makeResponseOfLpFormResponse(
  overrides: Partial<ResponseOfLpFormResponse> = {},
): ResponseOfLpFormResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLpFormResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
