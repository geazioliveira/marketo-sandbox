import type { Error } from '../models/error'
import type { SmartCampaignFlowSteps } from '../models/smart-campaign-flow-steps'

export interface ResponseOfSmartCampaignFlowStepActionType {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignFlowSteps>
  success?: boolean
  warnings?: Array<string>
}
