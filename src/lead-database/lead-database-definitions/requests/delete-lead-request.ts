import type { LeadInputData } from '../models/lead-input-data'

export interface DeleteLeadRequest {
  /**
   * List of leads for input
   */
  input: Array<LeadInputData>
}
