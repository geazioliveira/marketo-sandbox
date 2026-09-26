import type { Company } from '../models/company'

export type SyncCompanyRequestAction =
  'createOnly' | 'updateOnly' | 'createOrUpdate'

export interface SyncCompanyRequest {
  /**
   * Type of sync operation to perform
   */
  action?: SyncCompanyRequestAction
  /**
   * Field to deduplicate on. If the value in the field for a given record is not unique, an error will be returned for the individual record.
   */
  dedupeBy?: string
  /**
   * List of input records. Each 'Company' object contains a 'searchableField' for lookup purposes, and one or more 'fields' to create or update. Both can be retrieved using the Describe Companies endpoint
   */
  input: Array<Company>
}
