import { faker } from '@faker-js/faker'
import type { SmartCampaign } from '../../lead-database-definitions/models/smart-campaign'

export function makeSmartCampaign(
  overrides: Partial<SmartCampaign> = {},
): SmartCampaign {
  return {
    createdAt: faker.date.recent().toISOString(),
    smartCampaignId: faker.number.int({ min: 1, max: 99999 }),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
