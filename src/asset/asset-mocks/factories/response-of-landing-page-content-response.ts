import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfLandingPageContentResponse } from '../../asset-definitions/responses/response-of-landing-page-content-response'
import { makeLandingPageContentResponse } from './landing-page-content-response'

export function makeResponseOfLandingPageContentResponse(
  overrides: Partial<ResponseOfLandingPageContentResponse> = {},
): ResponseOfLandingPageContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLandingPageContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
