import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSmartCampaignFlowStepType } from '../../asset-definitions/models/response-of-smart-campaign-flow-step-type'
import { makeSmartCampaignFlowStepTypes } from './smart-campaign-flow-step-types'

export function makeResponseOfSmartCampaignFlowStepType(
  overrides: Partial<ResponseOfSmartCampaignFlowStepType> = {},
): ResponseOfSmartCampaignFlowStepType {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartCampaignFlowStepTypes(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
