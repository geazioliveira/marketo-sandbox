import type { Error } from '../models/error'
import type { SmartCampaignResponse } from './smart-campaign-response'

export interface ResponseOfSmartCampaignResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignResponse>
  success?: boolean
  warnings?: Array<string>
}
