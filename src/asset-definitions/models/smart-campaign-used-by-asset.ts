export interface SmartCampaignUsedByAsset {
  /**
   * Id of the asset
   */
  id: number;
  /**
   * Name of the asset
   */
  name: string;
  /**
   * Type of the asset
   */
  compType?: string;
  /**
   * Subtype of the asset
   */
  subType?: string;
  /**
   * Status of the asset
   */
  status?: string;
  /**
   * Datetime the asset was most recently updated
   */
  updatedAt?: string;
  /**
   * Id of the program containing the asset
   */
  programId?: number;
  /**
   * Id of the workspace containing the asset
   */
  accessZoneId?: number;
}
