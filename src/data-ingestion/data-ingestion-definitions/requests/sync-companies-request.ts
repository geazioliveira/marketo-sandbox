import type { Company } from '../models/company'

export type SyncCompaniesRequestAction =
  'createOnly' | 'updateOnly' | 'createOrUpdate'
export type SyncCompaniesRequestDedupeBy = 'dedupeFields' | 'idField'

export interface SyncCompaniesRequest {
  /**
   * Sync action. For createOnly and createOrUpdate, only dedupeFields is allowed for dedupeBy. For updateOnly, both dedupeFields and idField are allowed.
   */
  action?: SyncCompaniesRequestAction
  /**
   * Field to deduplicate on (case-insensitive).
   */
  dedupeBy?: SyncCompaniesRequestDedupeBy
  /**
   * List of company attribute name-value pairs.
   */
  input: Array<Company>
}
