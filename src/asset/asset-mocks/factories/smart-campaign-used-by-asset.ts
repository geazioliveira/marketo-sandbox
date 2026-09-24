import { faker } from '@faker-js/faker'
import type { SmartCampaignUsedByAsset } from '../../asset-definitions/models/smart-campaign-used-by-asset'

export function makeSmartCampaignUsedByAsset(
  overrides: Partial<SmartCampaignUsedByAsset> = {},
): SmartCampaignUsedByAsset {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    compType: faker.lorem.word(),
    subType: faker.lorem.word(),
    status: faker.lorem.word(),
    updatedAt: faker.date.recent().toISOString(),
    programId: faker.number.int({ min: 1, max: 99999 }),
    accessZoneId: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
