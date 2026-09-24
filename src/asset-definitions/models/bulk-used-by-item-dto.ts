export interface BulkUsedByItemDTO {
  id?: string;
  name?: string;
  /**
   * Number of places the asset is used.
   */
  count?: number;
  /**
   * Whether the asset is used by any other asset.
   */
  used?: boolean;
}
