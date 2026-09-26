import type { NamedAccountList } from '../models/named-account-list'

export interface DeleteNamedAccountListRequest {
  /**
   * Key to use for deletion of the record
   */
  deleteBy?: string
  /**
   * List of input records
   */
  input: Array<NamedAccountList>
}
