import type { Error } from '../models/error'
import type { SmartCampaignResponseWithFlow } from '../models/smart-campaign-response-with-flow'

export interface ResponseOfSmartCampaignResponseWithFlow {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignResponseWithFlow>
  success?: boolean
  warnings?: Array<string>
}
