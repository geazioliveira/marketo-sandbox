import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfLandingPageDynamicContentResponse } from '../../asset-definitions/responses/response-of-landing-page-dynamic-content-response'
import { makeLandingPageDynamicContentResponse } from './landing-page-dynamic-content-response'

export function makeResponseOfLandingPageDynamicContentResponse(
  overrides: Partial<ResponseOfLandingPageDynamicContentResponse> = {},
): ResponseOfLandingPageDynamicContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(
      () => makeLandingPageDynamicContentResponse(),
      { count: { min: 1, max: 3 } },
    ),
    success: true,
    warnings: [],
    ...overrides,
  }
}
