import type { Error } from '../models/error'
import type { Lead } from '../models/lead'
import type { Warning } from '../models/warning'

export interface ResponseOfLeadByListId {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors: Array<Error>
  /**
   * Paging token given if the result set exceeded the allowed batch size
   */
  nextPageToken?: string
  /**
   * Id of the request made
   */
  requestId: string
  /**
   * Array of results for individual records in the operation, may be empty
   */
  result: Array<Lead>
  /**
   * Whether the request succeeded
   */
  success: boolean
  /**
   * Array of warnings given for the operation
   */
  warnings: Array<Warning>
}
