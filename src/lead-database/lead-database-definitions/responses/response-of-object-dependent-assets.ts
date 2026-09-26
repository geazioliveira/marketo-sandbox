import type { Error } from '../models/error'
import type { ObjectDependentAsset } from '../models/object-dependent-asset'
import type { Warning } from '../models/warning'

export interface ResponseOfObjectDependentAssets {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors: Array<Error>
  /**
   * Id of the request made
   */
  requestId: string
  /**
   * List of dependent assets for a custom object type
   */
  result: Array<ObjectDependentAsset>
  /**
   * Whether the request succeeded
   */
  success: boolean
  /**
   * Array of warnings given for the operation
   */
  warnings: Array<Warning>
}
