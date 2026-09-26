import type { Reason } from './reason'

export interface ListOperationOutputData {
  /**
   * Unique integer id of a lead record
   */
  id: number
  /**
   * List of reasons why an operation did not succeed. Reasons are only present in API responses and should not be submitted
   */
  reasons?: Array<Reason>
  /**
   * Status of the operation performed on the record
   */
  status?: string
}
