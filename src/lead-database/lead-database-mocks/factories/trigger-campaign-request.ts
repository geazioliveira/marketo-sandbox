import type { TriggerCampaignRequest } from '../../lead-database-definitions/requests/trigger-campaign-request'
import { makeTriggerCampaignData } from './trigger-campaign-data'

export function makeTriggerCampaignRequest(
  overrides: Partial<TriggerCampaignRequest> = {},
): TriggerCampaignRequest {
  return {
    input: makeTriggerCampaignData(),
    ...overrides,
  }
}
