import type { Reason } from '../models/reason'

export type ProgramMemberStatusResponseStatus = 'updated' | 'skipped'

export interface ProgramMemberStatusResponse {
  /**
   * Status of the operation performed on the record
   */
  status: ProgramMemberStatusResponseStatus
  /**
   * List of reasons why an operation did not succeed. Reasons are only present in API responses and should not be submitted
   */
  reasons?: Array<Reason>
  /**
   * Id of the lead associated to the program member
   */
  leadId: number
  /**
   * Integer indicating the sequence of the record in response. This value is correlated to the order of the records included in the request input. Seq should only be part of responses and should not be submitted.
   */
  seq: number
}
