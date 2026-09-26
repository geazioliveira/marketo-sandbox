import type { Error } from '../models/error'
import type { Warning } from '../models/warning'

export interface ResponseOfCustomObjectTypeFieldDataTypes {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors: Array<Error>
  /**
   * Id of the request made
   */
  requestId: string
  /**
   * List of permissible data types for custom object fields
   */
  result: Array<string>
  /**
   * Whether the request succeeded
   */
  success: boolean
  /**
   * Array of warnings given for the operation
   */
  warnings: Array<Warning>
}
