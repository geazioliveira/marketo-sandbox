import type { ProgramOperation } from '../models/program-operation'

export interface SyncProgramMembersRequest {
  /**
   * List of program operations. Each specifies a program, a target status, and the leads to sync.
   */
  programs: Array<ProgramOperation>
}
