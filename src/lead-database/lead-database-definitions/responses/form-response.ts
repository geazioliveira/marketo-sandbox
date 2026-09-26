import type { Reason } from '../models/reason'

export type FormResponseStatus = 'created' | 'updated' | 'skipped'

export interface FormResponse {
  /**
   * Id of lead
   */
  id: number
  status: FormResponseStatus
  /**
   * List of reasons why an operation did not succeed. Reasons are only present in API responses and should not be submitted
   */
  reasons?: Array<Reason>
}
