import type { SmartCampaignUsedByAsset } from './smart-campaign-used-by-asset';

export interface SmartCampaignUsedBy {
  /**
   * Number of assets that use the smart campaign
   */
  usedByCount?: string;
  /**
   * Assets that use the smart campaign
   */
  usedBy?: Array<SmartCampaignUsedByAsset>;
}
