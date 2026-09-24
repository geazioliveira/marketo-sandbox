import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfEmailVariableResponse } from '../../asset-definitions/responses/response-of-email-variable-response'
import { makeEmailVariableResponse } from './email-variable-response'

export function makeResponseOfEmailVariableResponse(
  overrides: Partial<ResponseOfEmailVariableResponse> = {},
): ResponseOfEmailVariableResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailVariableResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
