import type { UpdateLeadField } from '../models/update-lead-field'

export interface UpdateLeadFieldRequest {
  /**
   * Single lead field for input
   */
  input: Array<UpdateLeadField>
}
