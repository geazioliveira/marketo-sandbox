import { faker } from '@faker-js/faker'
import type { SmartListRuleType } from '../../asset-definitions/models/smart-list-rule-type'
import { makeRuleConstraint } from './rule-constraint'

export function makeSmartListRuleType(
  overrides: Partial<SmartListRuleType> = {},
): SmartListRuleType {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.helpers.arrayElement(['activity', 'attribute'] as const),
    constraints: faker.helpers.multiple(() => makeRuleConstraint(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
