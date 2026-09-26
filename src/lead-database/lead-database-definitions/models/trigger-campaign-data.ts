import type { InputLead } from './input-lead'
import type { Token } from './token'

export interface TriggerCampaignData {
  /**
   * List of leads for input
   */
  leads: Array<InputLead>
  /**
   * List of my tokens to replace during the run of the target campaign. The tokens must be available in a parent program or folder to be replaced during the run
   */
  tokens?: Array<Token>
}
