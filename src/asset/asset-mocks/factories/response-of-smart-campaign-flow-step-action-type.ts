import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSmartCampaignFlowStepActionType } from '../../asset-definitions/models/response-of-smart-campaign-flow-step-action-type'
import { makeSmartCampaignFlowSteps } from './smart-campaign-flow-steps'

export function makeResponseOfSmartCampaignFlowStepActionType(
  overrides: Partial<ResponseOfSmartCampaignFlowStepActionType> = {},
): ResponseOfSmartCampaignFlowStepActionType {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartCampaignFlowSteps(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
