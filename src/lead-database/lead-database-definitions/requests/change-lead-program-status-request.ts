import type { LeadLookupInputData } from '../models/lead-lookup-input-data'

export interface ChangeLeadProgramStatusRequest {
  /**
   * List of leads for input
   */
  input: Array<LeadLookupInputData>
  /**
   * Program status of the record. Permissible values can be retrieve from the Get Channel by Name API for the designated program's channel
   */
  status: string
}
