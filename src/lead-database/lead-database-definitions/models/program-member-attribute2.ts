import type { LeadAttribute2Fields2 } from './lead-attribute2-fields2'
import type { LeadAttribute2SearchableFields } from './lead-attribute2-searchable-fields'

export interface ProgramMemberAttribute2 {
  /**
   * "API Program Member"
   */
  name: string
  /**
   * "API Program Member Map"
   */
  description: string
  /**
   * Datetime when created
   */
  createdAt: string
  /**
   * Datetime updated
   */
  updatedAt: string
  /**
   * List of dedupe fields
   */
  dedupeFields: Array<string>
  /**
   * List of searchable fields
   */
  searchableFields: Array<LeadAttribute2SearchableFields>
  /**
   * Description of searchable fields
   */
  fields: Array<LeadAttribute2Fields2>
}
