import type { LeadInputData } from '../models/lead-input-data'

export interface ListOperationRequest {
  /**
   * List of leads for input
   */
  input: Array<LeadInputData>
}
