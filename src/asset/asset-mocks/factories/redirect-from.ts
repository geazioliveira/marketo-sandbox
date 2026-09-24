import { faker } from '@faker-js/faker'
import type { RedirectFrom } from '../../asset-definitions/models/redirect-from'

export function makeRedirectFrom(
  overrides: Partial<RedirectFrom> = {},
): RedirectFrom {
  return {
    type: faker.helpers.arrayElement(['landingPageId', 'path'] as const),
    value: faker.lorem.word(),
    ...overrides,
  }
}
