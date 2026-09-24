export interface BulkUsedByRequest {
  /**
   * Asset IDs to query. Maximum 50 per request.
   */
  assetIds: Array<string>;
}
