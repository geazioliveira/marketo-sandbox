import type { DeleteProgramOperation } from '../models/delete-program-operation'

export interface DeleteProgramMembersRequest {
  /**
   * List of program delete operations.
   */
  programs: Array<DeleteProgramOperation>
}
