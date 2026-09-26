import type { NamedAccount } from '../models/named-account'

export interface AddNamedAccountListMemberRequest {
  /**
   * List of input records
   */
  input: Array<NamedAccount>
}
