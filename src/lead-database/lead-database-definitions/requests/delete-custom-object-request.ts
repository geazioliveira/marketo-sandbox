import type { CustomObject } from '../models/custom-object'

export interface DeleteCustomObjectRequest {
  /**
   * Field to delete records by. Permissible values are idField or dedupeFields as indicated by the result of the corresponding describe record
   */
  deleteBy?: string
  /**
   * List of input records
   */
  input: Array<CustomObject>
}
