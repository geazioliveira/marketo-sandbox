import { faker } from '@faker-js/faker'
import type { SmartListRules } from '../../asset-definitions/models/smart-list-rules'
import { makeSmartListFilters } from './smart-list-filters'

export function makeSmartListRules(
  overrides: Partial<SmartListRules> = {},
): SmartListRules {
  return {
    filterMatchType: faker.helpers.arrayElement([
      'all',
      'any',
      'custom',
    ] as const),
    triggers: faker.helpers.multiple(() => makeSmartListFilters(), {
      count: { min: 1, max: 3 },
    }),
    filters: faker.helpers.multiple(() => makeSmartListFilters(), {
      count: { min: 1, max: 3 },
    }),
    filterCustomRuleLogic: faker.lorem.word(),
    ...overrides,
  }
}
