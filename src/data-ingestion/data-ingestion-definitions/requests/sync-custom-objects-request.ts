import type { CustomObject } from '../models/custom-object'

export type SyncCustomObjectsRequestPriority = 'normal' | 'high'
export type SyncCustomObjectsRequestDedupeBy = 'dedupeFields' | 'marketoGUID'

export interface SyncCustomObjectsRequest {
  /**
   * Priority of the request.
   */
  priority?: SyncCustomObjectsRequestPriority
  /**
   * Attributes to deduplicate on.
   */
  dedupeBy?: SyncCustomObjectsRequestDedupeBy
  /**
   * List of attribute name-value pairs for the object.
   */
  customObjects: Array<CustomObject>
}
