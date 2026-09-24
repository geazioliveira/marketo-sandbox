import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfLpFormFieldResponse } from '../../asset-definitions/responses/response-of-lp-form-field-response'
import { makeLpFormFieldResponse } from './lp-form-field-response'

export function makeResponseOfLpFormFieldResponse(
  overrides: Partial<ResponseOfLpFormFieldResponse> = {},
): ResponseOfLpFormFieldResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLpFormFieldResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
