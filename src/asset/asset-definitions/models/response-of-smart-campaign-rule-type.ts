import type { Error } from './error'
import type { SmartCampaignRules } from './smart-campaign-rules'

export interface ResponseOfSmartCampaignRuleType {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignRules>
  success?: boolean
  warnings?: Array<string>
}
