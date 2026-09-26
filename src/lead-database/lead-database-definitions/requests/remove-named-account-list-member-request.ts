import type { NamedAccount } from '../models/named-account'

export interface RemoveNamedAccountListMemberRequest {
  /**
   * List of input records
   */
  input: Array<NamedAccount>
}
