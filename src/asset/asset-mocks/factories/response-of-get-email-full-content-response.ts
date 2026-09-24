import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfGetEmailFullContentResponse } from '../../asset-definitions/responses/response-of-get-email-full-content-response'
import { makeGetEmailFullContentResponse } from './get-email-full-content-response'

export function makeResponseOfGetEmailFullContentResponse(
  overrides: Partial<ResponseOfGetEmailFullContentResponse> = {},
): ResponseOfGetEmailFullContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeGetEmailFullContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
