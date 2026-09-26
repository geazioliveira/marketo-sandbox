import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfThankYouPageResponse } from '../../asset-definitions/responses/response-of-thank-you-page-response'
import { makeThankYouPageResponse } from './thank-you-page-response'

export function makeResponseOfThankYouPageResponse(
  overrides: Partial<ResponseOfThankYouPageResponse> = {},
): ResponseOfThankYouPageResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeThankYouPageResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
