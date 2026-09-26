import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfCampaign } from '../../lead-database-definitions/responses/response-of-campaign'
import { makeCampaign } from './campaign'

export function makeResponseOfCampaign(
  overrides: Partial<ResponseOfCampaign> = {},
): ResponseOfCampaign {
  return {
    errors: [],
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeCampaign(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
