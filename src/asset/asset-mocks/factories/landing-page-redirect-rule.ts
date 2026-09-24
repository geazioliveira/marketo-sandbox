import { faker } from '@faker-js/faker'
import type { LandingPageRedirectRule } from '../../asset-definitions/models/landing-page-redirect-rule'
import { makeRedirectFrom } from './redirect-from'
import { makeRedirectTo } from './redirect-to'

export function makeLandingPageRedirectRule(
  overrides: Partial<LandingPageRedirectRule> = {},
): LandingPageRedirectRule {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    redirectFromUrl: faker.internet.url(),
    redirectToUrl: faker.internet.url(),
    hostname: faker.internet.domainName(),
    redirectFrom: makeRedirectFrom(),
    redirectTo: makeRedirectTo(),
    createdAt: faker.date.recent().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
