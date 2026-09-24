import { faker } from '@faker-js/faker'
import type { UpdateSmartCampaignRequest } from '../../asset-definitions/requests/update-smart-campaign-request'

export function makeUpdateSmartCampaignRequest(
  overrides: Partial<UpdateSmartCampaignRequest> = {},
): UpdateSmartCampaignRequest {
  return {
    description: faker.lorem.sentence(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
