import type { NamedAccount } from '../models/named-account'

export interface DeleteNamedAccountRequest {
  /**
   * Key to use for deletion of the record
   */
  deleteBy?: string
  /**
   * List of input records
   */
  input: Array<NamedAccount>
}
