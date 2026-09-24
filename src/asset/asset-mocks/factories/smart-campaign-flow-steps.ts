import { faker } from '@faker-js/faker'
import type { SmartCampaignFlowSteps } from '../../asset-definitions/models/smart-campaign-flow-steps'
import { makeSmartCampaignFlowStepActionType } from './smart-campaign-flow-step-action-type'

export function makeSmartCampaignFlowSteps(
  overrides: Partial<SmartCampaignFlowSteps> = {},
): SmartCampaignFlowSteps {
  return {
    flowSteps: faker.helpers.multiple(
      () => makeSmartCampaignFlowStepActionType(),
      { count: { min: 1, max: 3 } },
    ),
    ...overrides,
  }
}
