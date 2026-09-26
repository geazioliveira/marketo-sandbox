import type { ProgramMember } from './program-member'

export interface ProgramOperation {
  /**
   * The Marketo program ID. Must be a positive integer.
   */
  programId: number
  /**
   * The program member status to set (e.g. 'Member', 'Influenced'). Must not be 'Not in Program'; use the delete endpoint instead.
   */
  status: string
  /**
   * List of lead references to add or update in the program.
   */
  members: Array<ProgramMember>
}
