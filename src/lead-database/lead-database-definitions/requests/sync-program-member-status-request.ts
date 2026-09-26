import type { ProgramMemberStatus } from '../models/program-member-status'

export interface SyncProgramMemberStatusRequest {
  /**
   * Program member status
   */
  statusName: string
  /**
   * List of input records
   */
  input: Array<ProgramMemberStatus>
}
