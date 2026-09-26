import type { Error } from '../models/error'
import type { SmartCampaignUsedBy } from '../models/smart-campaign-used-by'

export interface ResponseOfSmartCampaignUsedBy {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignUsedBy>
  success?: boolean
  warnings?: Array<string>
}
