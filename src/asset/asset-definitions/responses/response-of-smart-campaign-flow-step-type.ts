import type { Error } from '../models/error'
import type { SmartCampaignFlowStepTypes } from '../models/smart-campaign-flow-step-types'

export interface ResponseOfSmartCampaignFlowStepType {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignFlowStepTypes>
  success?: boolean
  warnings?: Array<string>
}
