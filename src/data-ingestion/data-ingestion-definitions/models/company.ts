export interface Company {
  /**
   * Marketo internal company ID. Required when dedupeBy is idField and action is updateOnly.
   */
  id?: number
  /**
   * External company identifier. Required when dedupeBy is dedupeFields.
   */
  externalCompanyId?: string
  /**
   * Company name.
   */
  company?: string
}
