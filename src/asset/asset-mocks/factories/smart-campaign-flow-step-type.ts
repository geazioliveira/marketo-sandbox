import { faker } from '@faker-js/faker'
import type { SmartCampaignFlowStepType } from '../../asset-definitions/models/smart-campaign-flow-step-type'
import { makeRuleConstraint } from './rule-constraint'

export function makeSmartCampaignFlowStepType(
  overrides: Partial<SmartCampaignFlowStepType> = {},
): SmartCampaignFlowStepType {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    constraints: faker.helpers.multiple(() => makeRuleConstraint(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
