import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfEmailResponse } from '../../asset-definitions/responses/response-of-email-response'
import { makeEmailResponse } from './email-response'

export function makeResponseOfEmailResponse(
  overrides: Partial<ResponseOfEmailResponse> = {},
): ResponseOfEmailResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
