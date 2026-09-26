import type { Error } from '../models/error'
import type { ObjectLinkableObject } from '../models/object-linkable-object'
import type { Warning } from '../models/warning'

export interface ResponseOfObjectLinkableObject {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors: Array<Error>
  /**
   * Id of the request made
   */
  requestId: string
  /**
   * List of permissible objects to use as custom object link field
   */
  result: Array<ObjectLinkableObject>
  /**
   * Whether the request succeeded
   */
  success: boolean
  /**
   * Array of warnings given for the operation
   */
  warnings: Array<Warning>
}
