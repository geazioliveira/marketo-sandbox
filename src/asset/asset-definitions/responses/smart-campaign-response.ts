import type { Folder } from '../models/folder'
import type { Recurrence } from '../models/recurrence'

export type SmartCampaignResponseType = 'batch' | 'default' | 'trigger'
export type SmartCampaignResponseQualificationRuleType =
  'once' | 'any' | 'interval'
export type SmartCampaignResponseQualificationRuleUnit =
  'hour' | 'day' | 'week' | 'month'
export type SmartCampaignResponseStatus =
  | 'Inactive'
  | 'Single Run'
  | 'Invalid'
  | 'Recurring Run'
  | 'Active'
  | 'Requested'
  | 'Never Run'

export interface SmartCampaignResponse {
  /**
   * Id of the smart campaign (system managed)
   */
  id: number
  /**
   * Name of the smart campaign
   */
  name: string
  /**
   * Description of the smart campaign
   */
  description: string
  /**
   * Type of the smart campaign. Batch: has at least one filter and no triggers. Trigger: has at least one trigger. Default: has no smart list rules
   */
  type: SmartCampaignResponseType
  /**
   * Whether smart campaign is system managed. Defaults to false
   */
  isSystem: boolean
  /**
   * Whether smart campaign is active. Defaults to false
   */
  isActive: boolean
  /**
   * Whether smart campaign is requestable (is active and contains 'Campaign is Requested' trigger with Source of 'Web Service API'). Defaults to false
   */
  isRequestable: boolean
  /**
   * Recurrence schedule of batch smart campaign
   */
  recurrence: Recurrence
  /**
   * Type of qualification rule. Defaults to 'once'
   */
  qualificationRuleType: SmartCampaignResponseQualificationRuleType
  /**
   * Interval of qualification rule. Only set when qualificationRuleType is 'interval'
   */
  qualificationRuleInterval: number
  /**
   * Unit of measure of qualification rule. Only set when qualificationRuleType is 'interval'
   */
  qualificationRuleUnit: SmartCampaignResponseQualificationRuleUnit
  /**
   * Smart campaign membership limit
   */
  maxMembers: number
  /**
   * Whether smart campaign communication limit is enabled (i.e. block non-operational emails). Defaults to false
   */
  isCommunicationLimitEnabled: boolean
  /**
   * Id of the smart campaign's child smart list
   */
  smartListId: number
  /**
   * Id of the smart campaign's child flow
   */
  flowId: number
  /**
   * Parent program Id. Present if smart campaign is under program or nested folder
   */
  parentProgramId?: number
  /**
   * JSON representation of parent folder, with members 'id', and 'type' which may be 'Folder' or 'Program'
   */
  folder: Folder
  /**
   * Datetime when the smart campaign was created
   */
  createdAt: string
  /**
   * Datetime when the smart campaign was most recently updated
   */
  updatedAt: string
  /**
   * Name of the smart campaign workspace
   */
  workspace: string
  /**
   * URL to asset in Marketo Engage
   */
  computedUrl?: string
  /**
   * Status of smart campaign
   */
  status: SmartCampaignResponseStatus
}
