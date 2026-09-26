import type { ChangeLeadProgramStatusOutputData } from '../models/change-lead-program-status-output-data'
import type { Error } from '../models/error'
import type { Warning } from '../models/warning'

export interface ResponseOfChangeLeadProgramStatusOutputData {
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
  result: Array<ChangeLeadProgramStatusOutputData>
  /**
   * Whether the request succeeded
   */
  success: boolean
  /**
   * Array of warnings given for the operation
   */
  warnings: Array<Warning>
}
