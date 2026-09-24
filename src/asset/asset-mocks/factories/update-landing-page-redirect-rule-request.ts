import { faker } from '@faker-js/faker'
import type { UpdateLandingPageRedirectRuleRequest } from '../../asset-definitions/requests/update-landing-page-redirect-rule-request'
import { makeRedirectFrom } from './redirect-from'
import { makeRedirectTo } from './redirect-to'

export function makeUpdateLandingPageRedirectRuleRequest(
  overrides: Partial<UpdateLandingPageRedirectRuleRequest> = {},
): UpdateLandingPageRedirectRuleRequest {
  return {
    hostname: faker.internet.domainName(),
    redirectFrom: makeRedirectFrom(),
    redirectTo: makeRedirectTo(),
    ...overrides,
  }
}
