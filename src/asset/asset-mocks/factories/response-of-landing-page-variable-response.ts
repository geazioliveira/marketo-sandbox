import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfLandingPageVariableResponse } from '../../asset-definitions/responses/response-of-landing-page-variable-response'
import { makeLandingPageVariableResponse } from './landing-page-variable-response'

export function makeResponseOfLandingPageVariableResponse(
  overrides: Partial<ResponseOfLandingPageVariableResponse> = {},
): ResponseOfLandingPageVariableResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLandingPageVariableResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
