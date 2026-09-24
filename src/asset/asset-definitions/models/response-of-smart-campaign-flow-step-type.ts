import type { Error } from './error'
import type { SmartCampaignFlowStepTypes } from './smart-campaign-flow-step-types'

export interface ResponseOfSmartCampaignFlowStepType {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartCampaignFlowStepTypes>
  success?: boolean
  warnings?: Array<string>
}
