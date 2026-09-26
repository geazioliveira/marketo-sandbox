import { faker } from '@faker-js/faker'
import type { TriggerCampaignData } from '../../lead-database-definitions/models/trigger-campaign-data'
import { makeInputLead } from './input-lead'
import { makeToken } from './token'

export function makeTriggerCampaignData(
  overrides: Partial<TriggerCampaignData> = {},
): TriggerCampaignData {
  return {
    leads: faker.helpers.multiple(() => makeInputLead(), {
      count: { min: 1, max: 3 },
    }),
    tokens: faker.helpers.multiple(() => makeToken(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
