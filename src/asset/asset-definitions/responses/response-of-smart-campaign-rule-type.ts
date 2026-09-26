import type { Error } from '../models/error'
import type { SmartCampaignRules } from '../models/smart-campaign-rules'

export interface ResponseOfSmartCampaignRuleType {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignRules>
  success?: boolean
  warnings?: Array<string>
}
