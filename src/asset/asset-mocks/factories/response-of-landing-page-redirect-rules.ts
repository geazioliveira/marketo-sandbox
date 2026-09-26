import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfLandingPageRedirectRules } from '../../asset-definitions/responses/response-of-landing-page-redirect-rules'
import { makeLandingPageRedirectRule } from './landing-page-redirect-rule'

export function makeResponseOfLandingPageRedirectRules(
  overrides: Partial<ResponseOfLandingPageRedirectRules> = {},
): ResponseOfLandingPageRedirectRules {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLandingPageRedirectRule(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
