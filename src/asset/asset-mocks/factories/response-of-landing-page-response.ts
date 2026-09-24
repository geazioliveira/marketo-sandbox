import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfLandingPageResponse } from '../../asset-definitions/responses/response-of-landing-page-response'
import { makeLandingPageResponse } from './landing-page-response'

export function makeResponseOfLandingPageResponse(
  overrides: Partial<ResponseOfLandingPageResponse> = {},
): ResponseOfLandingPageResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLandingPageResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
