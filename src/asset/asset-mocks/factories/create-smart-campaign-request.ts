import { faker } from '@faker-js/faker'
import type { CreateSmartCampaignRequest } from '../../asset-definitions/requests/create-smart-campaign-request'
import { makeFolder } from './folder'

export function makeCreateSmartCampaignRequest(
  overrides: Partial<CreateSmartCampaignRequest> = {},
): CreateSmartCampaignRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
