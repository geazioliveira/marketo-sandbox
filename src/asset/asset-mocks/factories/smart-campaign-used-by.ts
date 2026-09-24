import { faker } from '@faker-js/faker'
import type { SmartCampaignUsedBy } from '../../asset-definitions/models/smart-campaign-used-by'
import { makeSmartCampaignUsedByAsset } from './smart-campaign-used-by-asset'

export function makeSmartCampaignUsedBy(
  overrides: Partial<SmartCampaignUsedBy> = {},
): SmartCampaignUsedBy {
  return {
    usedByCount: faker.lorem.word(),
    usedBy: faker.helpers.multiple(() => makeSmartCampaignUsedByAsset(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
