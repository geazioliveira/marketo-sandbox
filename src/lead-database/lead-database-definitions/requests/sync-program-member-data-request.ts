import type { ProgramMemberData } from '../models/program-member-data'

export interface SyncProgramMemberDataRequest {
  /**
   * List of input records
   */
  input: Array<ProgramMemberData>
}
