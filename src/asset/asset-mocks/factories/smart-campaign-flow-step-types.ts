import { faker } from '@faker-js/faker'
import type { SmartCampaignFlowStepTypes } from '../../asset-definitions/models/smart-campaign-flow-step-types'
import { makeSmartCampaignFlowStepType } from './smart-campaign-flow-step-type'

export function makeSmartCampaignFlowStepTypes(
  overrides: Partial<SmartCampaignFlowStepTypes> = {},
): SmartCampaignFlowStepTypes {
  return {
    flowStepTypes: faker.helpers.multiple(
      () => makeSmartCampaignFlowStepType(),
      { count: { min: 1, max: 3 } },
    ),
    ...overrides,
  }
}
