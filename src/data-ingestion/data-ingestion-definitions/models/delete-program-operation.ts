import type { ProgramMember } from './program-member'

export interface DeleteProgramOperation {
  /**
   * The Marketo program ID. Must be a positive integer.
   */
  programId: number
  /**
   * List of lead references to remove from the program.
   */
  members: Array<ProgramMember>
}
