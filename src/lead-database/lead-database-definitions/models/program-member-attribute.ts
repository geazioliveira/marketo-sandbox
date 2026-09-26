import type { LeadAttribute2Fields } from './lead-attribute2-fields'

export interface ProgramMemberAttribute {
  /**
   * "API Program Member"
   */
  name?: string
  /**
   * Description of searchable fields
   */
  fields: Array<LeadAttribute2Fields>
}
