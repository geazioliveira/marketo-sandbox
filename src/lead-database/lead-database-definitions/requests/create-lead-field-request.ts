import type { CreateLeadField } from '../models/create-lead-field'

export interface CreateLeadFieldRequest {
  /**
   * List of lead fields for input
   */
  input: Array<CreateLeadField>
}
