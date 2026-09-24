export interface BulkGetRequest {
  /**
   * Set of asset IDs to retrieve. Maximum 20 per request.
   */
  assetIds: Array<string>;
}
