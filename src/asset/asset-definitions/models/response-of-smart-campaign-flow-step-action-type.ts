import type { Error } from './error'
import type { SmartCampaignFlowSteps } from './smart-campaign-flow-steps'

export interface ResponseOfSmartCampaignFlowStepActionType {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignFlowSteps>
  success?: boolean
  warnings?: Array<string>
}
