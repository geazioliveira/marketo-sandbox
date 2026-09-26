import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfFormUsedByResponse } from '../../asset-definitions/responses/response-of-form-used-by-response'
import { makeFormUsedByResponse } from './form-used-by-response'

export function makeResponseOfFormUsedByResponse(
  overrides: Partial<ResponseOfFormUsedByResponse> = {},
): ResponseOfFormUsedByResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeFormUsedByResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
