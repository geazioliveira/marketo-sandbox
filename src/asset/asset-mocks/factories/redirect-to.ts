import { faker } from '@faker-js/faker'
import type { RedirectTo } from '../../asset-definitions/models/redirect-to'

export function makeRedirectTo(
  overrides: Partial<RedirectTo> = {},
): RedirectTo {
  return {
    type: faker.helpers.arrayElement(['landingPageId', 'url'] as const),
    value: faker.lorem.word(),
    ...overrides,
  }
}
