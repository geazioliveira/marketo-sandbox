export interface ObjectDependentAsset {
  /**
   * Type of asset
   */
  assetType: string
  /**
   * ID of asset
   */
  assetId: number
  /**
   * Name of asset
   */
  assetName: string
  /**
   * List of associated fields
   */
  usedFields?: Array<string>
}
