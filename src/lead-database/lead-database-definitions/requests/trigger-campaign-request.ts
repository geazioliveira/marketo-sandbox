import type { TriggerCampaignData } from '../models/trigger-campaign-data'

export interface TriggerCampaignRequest {
  /**
   * Object describing trigger configuration for the campaign
   */
  input: TriggerCampaignData
}
