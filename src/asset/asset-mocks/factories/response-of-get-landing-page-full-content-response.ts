import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfGetLandingPageFullContentResponse } from '../../asset-definitions/responses/response-of-get-landing-page-full-content-response'
import { makeGetLandingPageFullContentResponse } from './get-landing-page-full-content-response'

export function makeResponseOfGetLandingPageFullContentResponse(
  overrides: Partial<ResponseOfGetLandingPageFullContentResponse> = {},
): ResponseOfGetLandingPageFullContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(
      () => makeGetLandingPageFullContentResponse(),
      { count: { min: 1, max: 3 } },
    ),
    success: true,
    warnings: [],
    ...overrides,
  }
}
