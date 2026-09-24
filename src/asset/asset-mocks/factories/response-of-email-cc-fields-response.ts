import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfEmailCCFieldsResponse } from '../../asset-definitions/responses/response-of-email-cc-fields-response'
import { makeEmailCCFields } from './email-cc-fields'

export function makeResponseOfEmailCCFieldsResponse(
  overrides: Partial<ResponseOfEmailCCFieldsResponse> = {},
): ResponseOfEmailCCFieldsResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailCCFields(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
