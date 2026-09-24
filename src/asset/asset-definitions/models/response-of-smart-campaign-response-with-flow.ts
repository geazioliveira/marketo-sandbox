import type { Error } from './error'
import type { SmartCampaignResponseWithFlow } from './smart-campaign-response-with-flow'

export interface ResponseOfSmartCampaignResponseWithFlow {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignResponseWithFlow>
  success?: boolean
  warnings?: Array<string>
}
