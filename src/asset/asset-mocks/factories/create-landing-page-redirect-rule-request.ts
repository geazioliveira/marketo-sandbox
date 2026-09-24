import { faker } from '@faker-js/faker'
import type { CreateLandingPageRedirectRuleRequest } from '../../asset-definitions/requests/create-landing-page-redirect-rule-request'
import { makeRedirectFrom } from './redirect-from'
import { makeRedirectTo } from './redirect-to'

export function makeCreateLandingPageRedirectRuleRequest(
  overrides: Partial<CreateLandingPageRedirectRuleRequest> = {},
): CreateLandingPageRedirectRuleRequest {
  return {
    hostname: faker.internet.domainName(),
    redirectFrom: makeRedirectFrom(),
    redirectTo: makeRedirectTo(),
    ...overrides,
  }
}
