import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSmartCampaignRuleType } from '../../asset-definitions/models/response-of-smart-campaign-rule-type'
import { makeSmartCampaignRules } from './smart-campaign-rules'

export function makeResponseOfSmartCampaignRuleType(
  overrides: Partial<ResponseOfSmartCampaignRuleType> = {},
): ResponseOfSmartCampaignRuleType {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartCampaignRules(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
