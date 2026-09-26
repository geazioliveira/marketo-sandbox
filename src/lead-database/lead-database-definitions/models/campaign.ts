export type CampaignType = 'batch' | 'trigger'

export interface Campaign {
  /**
   * Whether the campaign is active. Only applicable to trigger campaigns
   */
  active?: boolean
  /**
   * Datetime when the campaign was created
   */
  createdAt: string
  /**
   * Description of the Smart Campaign
   */
  description?: string
  /**
   * Unique integer id of the Smart Campaign
   */
  id: number
  /**
   * Name of the Smart Campaign
   */
  name: string
  /**
   * Id of the parent program if applicable
   */
  programId?: number
  /**
   * Name of the parent program if applicable
   */
  programName?: string
  /**
   * Type of the Smart Campaign
   */
  type: CampaignType
  /**
   * Datetime when the campaign was most recently updated
   */
  updatedAt: string
  /**
   * Name of the parent workspace if applicable
   */
  workspaceName?: string
}
