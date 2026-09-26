import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfSmartCampaignResponse } from '../../asset-definitions/responses/response-of-smart-campaign-response'
import { makeSmartCampaignResponse } from './smart-campaign-response'

export function makeResponseOfSmartCampaignResponse(
  overrides: Partial<ResponseOfSmartCampaignResponse> = {},
): ResponseOfSmartCampaignResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartCampaignResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
