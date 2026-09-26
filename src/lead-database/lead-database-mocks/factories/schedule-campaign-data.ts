import { faker } from '@faker-js/faker'
import type { ScheduleCampaignData } from '../../lead-database-definitions/models/schedule-campaign-data'
import { makeToken } from './token'

export function makeScheduleCampaignData(
  overrides: Partial<ScheduleCampaignData> = {},
): ScheduleCampaignData {
  return {
    cloneToProgramName: faker.lorem.words({ min: 2, max: 3 }),
    runAt: faker.date.recent().toISOString(),
    tokens: faker.helpers.multiple(() => makeToken(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
