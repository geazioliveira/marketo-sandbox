import { faker } from '@faker-js/faker'
import type { SmartCampaignRules } from '../../asset-definitions/models/smart-campaign-rules'
import { makeSmartCampaignRuleType } from './smart-campaign-rule-type'

export function makeSmartCampaignRules(
  overrides: Partial<SmartCampaignRules> = {},
): SmartCampaignRules {
  return {
    filters: faker.helpers.multiple(() => makeSmartCampaignRuleType(), {
      count: { min: 1, max: 3 },
    }),
    triggers: faker.helpers.multiple(() => makeSmartCampaignRuleType(), {
      count: { min: 1, max: 3 },
    }),
    predictiveFilters: {},
    ...overrides,
  }
}
