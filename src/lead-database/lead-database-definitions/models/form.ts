import type { LeadFormFields } from './lead-form-fields'
import type { VisitorData } from './visitor-data'

export interface Form {
  /**
   * List of form fields. Email is required field
   */
  leadFormFields: LeadFormFields
  /**
   * Page visit-related data
   */
  visitorData?: VisitorData
  /**
   * Munchkin cookie value used to associate new lead with anonymous activities. e.g. id:123-XYZ-456&tooken:_mch-marketo.com-1594662481190-60776
   */
  cookie?: string
}
