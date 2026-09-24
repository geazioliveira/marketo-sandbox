import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSmartCampaignUsedBy } from '../../asset-definitions/models/response-of-smart-campaign-used-by'
import { makeSmartCampaignUsedBy } from './smart-campaign-used-by'

export function makeResponseOfSmartCampaignUsedBy(
  overrides: Partial<ResponseOfSmartCampaignUsedBy> = {},
): ResponseOfSmartCampaignUsedBy {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartCampaignUsedBy(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
