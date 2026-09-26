import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfEmailDynamicContentResponse } from '../../asset-definitions/responses/response-of-email-dynamic-content-response'
import { makeEmailDynamicContentResponse } from './email-dynamic-content-response'

export function makeResponseOfEmailDynamicContentResponse(
  overrides: Partial<ResponseOfEmailDynamicContentResponse> = {},
): ResponseOfEmailDynamicContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailDynamicContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
