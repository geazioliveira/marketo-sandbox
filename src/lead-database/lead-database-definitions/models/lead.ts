import type { ProgramMembership } from './program-membership'
import type { Reason } from './reason'

export interface Lead {
  /**
   * Unique integer id of a lead record
   */
  id?: number
  /**
   * Membership data for the parent program. Only returned via Get Leads By Program Id
   */
  membership?: ProgramMembership
  /**
   * Reason object describing why an operation did not succeed for a record
   */
  reason?: Reason
  /**
   * Status of the operation performed on the record
   */
  status?: string
}
