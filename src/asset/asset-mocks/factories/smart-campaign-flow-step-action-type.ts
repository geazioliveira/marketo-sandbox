import { faker } from '@faker-js/faker'
import type { SmartCampaignFlowStepActionType } from '../../asset-definitions/models/smart-campaign-flow-step-action-type'
import { makeRuleConstraint } from './rule-constraint'

export function makeSmartCampaignFlowStepActionType(
  overrides: Partial<SmartCampaignFlowStepActionType> = {},
): SmartCampaignFlowStepActionType {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    constraints: faker.helpers.multiple(() => makeRuleConstraint(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
