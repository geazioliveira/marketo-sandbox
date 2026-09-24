import { faker } from '@faker-js/faker'
import type { CloneSmartCampaignRequest } from '../../asset-definitions/requests/clone-smart-campaign-request'
import { makeFolder } from './folder'

export function makeCloneSmartCampaignRequest(
  overrides: Partial<CloneSmartCampaignRequest> = {},
): CloneSmartCampaignRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
