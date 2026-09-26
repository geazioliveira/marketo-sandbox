import type { Reason } from './reason'

export interface ChangeLeadProgramStatusOutputData {
  /**
   * Unique integer id of a lead record
   */
  id: number
  /**
   * List of reasons why an operation did not succeed. Reasons are only present in API responses and should not be submitted
   */
  reasons?: Array<Reason>
  /**
   * Program status of the record. Permissible values can be retrieve from the Get Channel by Name API for the designated program's channel
   */
  status: string
}
