export interface BulkDeleteRequest {
  /**
   * Set of asset IDs to delete. Maximum 20 per request.
   */
  assetIds: Array<string>
  /**
   * If true, deletes assets even if they are referenced by other assets.
   */
  ignoreUsedBy?: boolean
}
