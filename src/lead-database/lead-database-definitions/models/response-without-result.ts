import type { Error } from './error'
import type { Warning } from './warning'

export interface ResponseWithoutResult {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors?: Array<Error>
  /**
   * Paging token returned from a previous response
   */
  nextPageToken?: string
  /**
   * Id of the request made
   */
  requestId: string
  /**
   * Whether the request succeeded
   */
  success: boolean
  /**
   * Array of warnings given for the operation
   */
  warnings?: Array<Warning>
}
