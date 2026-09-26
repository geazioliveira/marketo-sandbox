import type { NamedAccountList } from '../models/named-account-list'

export type SyncNamedAccountListRequestAction = 'createOnly' | 'updateOnly'

export interface SyncNamedAccountListRequest {
  /**
   * Type of sync operation to perform
   */
  action?: SyncNamedAccountListRequestAction
  /**
   * Field to deduplicate on. If the value in the field for a given record is not unique, an error will be returned for the individual record.
   */
  dedupeBy?: string
  /**
   * List of input records
   */
  input: Array<NamedAccountList>
}
