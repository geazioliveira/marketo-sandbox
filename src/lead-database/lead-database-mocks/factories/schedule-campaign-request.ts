import type { ScheduleCampaignRequest } from '../../lead-database-definitions/requests/schedule-campaign-request'
import { makeScheduleCampaignData } from './schedule-campaign-data'

export function makeScheduleCampaignRequest(
  overrides: Partial<ScheduleCampaignRequest> = {},
): ScheduleCampaignRequest {
  return {
    input: makeScheduleCampaignData(),
    ...overrides,
  }
}
