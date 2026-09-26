import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfLandingPageDomains } from '../../asset-definitions/responses/response-of-landing-page-domains'
import { makeLandingPageDomain } from './landing-page-domain'

export function makeResponseOfLandingPageDomains(
  overrides: Partial<ResponseOfLandingPageDomains> = {},
): ResponseOfLandingPageDomains {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLandingPageDomain(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
