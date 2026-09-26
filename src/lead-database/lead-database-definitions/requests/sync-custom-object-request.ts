import type { CustomObject } from '../models/custom-object'

export type SyncCustomObjectRequestAction =
  'createOnly' | 'updateOnly' | 'createOrUpdate'

export interface SyncCustomObjectRequest {
  /**
   * Type of sync operation to perform
   */
  action?: SyncCustomObjectRequestAction
  /**
   * Field to deduplicate on. If the value in the field for a given record is not unique, an error will be returned for the individual record.
   */
  dedupeBy?: string
  /**
   * List of input records
   */
  input: Array<CustomObject>
}
