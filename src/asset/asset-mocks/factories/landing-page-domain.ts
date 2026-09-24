import { faker } from '@faker-js/faker'
import type { LandingPageDomain } from '../../asset-definitions/models/landing-page-domain'

export function makeLandingPageDomain(
  overrides: Partial<LandingPageDomain> = {},
): LandingPageDomain {
  return {
    hostname: faker.internet.domainName(),
    type: faker.helpers.arrayElement(['domain', 'domain-alias'] as const),
    ...overrides,
  }
}
