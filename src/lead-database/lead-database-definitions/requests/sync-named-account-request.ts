import type { NamedAccount } from '../models/named-account'

export type SyncNamedAccountRequestAction =
  'createOnly' | 'updateOnly' | 'createOrUpdate'

export interface SyncNamedAccountRequest {
  /**
   * Type of sync operation to perform
   */
  action?: SyncNamedAccountRequestAction
  /**
   * Field to deduplicate on. If the value in the field for a given record is not unique, an error will be returned for the individual record.
   */
  dedupeBy?: string
  /**
   * List of input records
   */
  input: Array<NamedAccount>
}
