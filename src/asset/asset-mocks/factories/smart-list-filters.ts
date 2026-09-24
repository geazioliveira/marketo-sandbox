import { faker } from '@faker-js/faker'
import type { SmartListFilters } from '../../asset-definitions/models/smart-list-filters'
import { makeSmartListConditions } from './smart-list-conditions'

export function makeSmartListFilters(
  overrides: Partial<SmartListFilters> = {},
): SmartListFilters {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ruleTypeId: faker.number.int({ min: 1, max: 99999 }),
    ruleType: faker.helpers.arrayElement(['Activity', 'Attribute'] as const),
    operator: faker.lorem.word(),
    conditions: faker.helpers.multiple(() => makeSmartListConditions(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
