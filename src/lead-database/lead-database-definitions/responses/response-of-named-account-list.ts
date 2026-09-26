import type { Error } from '../models/error'
import type { NamedAccountList } from '../models/named-account-list'
import type { Warning } from '../models/warning'

export interface ResponseOfNamedAccountList {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors: Array<Error>
  /**
   * Boolean indicating if there are more results in subsequent pages
   */
  moreResult?: boolean
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
  result: Array<NamedAccountList>
  /**
   * Whether the request succeeded
   */
  success: boolean
  /**
   * Array of warnings given for the operation
   */
  warnings: Array<Warning>
}
