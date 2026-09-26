import type { ProgramMemberDelete } from '../models/program-member-delete'

export interface DeleteProgramMemberRequest {
  /**
   * List of input records
   */
  input: Array<ProgramMemberDelete>
}
