import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSmartCampaignResponseWithFlow } from '../../asset-definitions/models/response-of-smart-campaign-response-with-flow'
import { makeSmartCampaignResponseWithFlow } from './smart-campaign-response-with-flow'

export function makeResponseOfSmartCampaignResponseWithFlow(
  overrides: Partial<ResponseOfSmartCampaignResponseWithFlow> = {},
): ResponseOfSmartCampaignResponseWithFlow {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartCampaignResponseWithFlow(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
