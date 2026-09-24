import { faker } from '@faker-js/faker'
import type { SmartCampaignRuleType } from '../../asset-definitions/models/smart-campaign-rule-type'
import { makeRuleConstraint } from './rule-constraint'

export function makeSmartCampaignRuleType(
  overrides: Partial<SmartCampaignRuleType> = {},
): SmartCampaignRuleType {
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
