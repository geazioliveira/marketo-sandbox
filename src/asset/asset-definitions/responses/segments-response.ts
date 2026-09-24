export interface SegmentsResponse {
  /**
   * Datetime the asset was created
   */
  createdAt?: string
  /**
   * Description of the asset
   */
  description?: string
  /**
   * Id of the asset
   */
  id?: number
  /**
   * Name of the asset
   */
  name?: string
  /**
   * Id of the Segmentation
   */
  segmentationId: number
  /**
   * Datetime the asset was most recently updated
   */
  updatedAt?: string
  /**
   * Url of the asset in the Marketo UI
   */
  url?: string
}
