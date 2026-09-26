import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfSmartCampaigns } from '../../lead-database-definitions/responses/response-of-smart-campaigns'
import { makeSmartCampaign } from './smart-campaign'

export function makeResponseOfSmartCampaigns(
  overrides: Partial<ResponseOfSmartCampaigns> = {},
): ResponseOfSmartCampaigns {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartCampaign(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
