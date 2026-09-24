import { faker } from '@faker-js/faker'
import type { SmartListRuleTypes } from '../../asset-definitions/models/smart-list-rule-types'
import { makeSmartListRuleType } from './smart-list-rule-type'

export function makeSmartListRuleTypes(
  overrides: Partial<SmartListRuleTypes> = {},
): SmartListRuleTypes {
  return {
    filters: faker.helpers.multiple(() => makeSmartListRuleType(), {
      count: { min: 1, max: 3 },
    }),
    predictiveFilters: {},
    ...overrides,
  }
}
