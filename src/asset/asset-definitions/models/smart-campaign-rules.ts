import type { SmartCampaignRuleType } from './smart-campaign-rule-type'

export interface SmartCampaignRules {
  /**
   * Filter rule types
   */
  filters?: Array<SmartCampaignRuleType>
  /**
   * Trigger rule types
   */
  triggers?: Array<SmartCampaignRuleType>
  /**
   * Predictive filter rule types. Present when predictive attributes are available
   */
  predictiveFilters?: Record<string, unknown>
}
