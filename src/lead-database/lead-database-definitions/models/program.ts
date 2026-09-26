export interface Program {
  /**
   * Unique integer id of a program record
   */
  id: number
  /**
   * Whether the lead was acquired by the parent program
   */
  acquiredBy: boolean
  /**
   * Whether the lead is currently exhausted in the stream, if applicable
   */
  isExhausted: boolean
  /**
   * Date the lead first became a member of the program
   */
  membershipDate: string
  /**
   * Cadence of the parent stream if applicable
   */
  nurtureCadence?: string
  /**
   * Program status of the lead in the parent program
   */
  progressionStatus: string
  /**
   * Whether the lead is in a success-status in the parent program
   */
  reachedSuccess: boolean
  /**
   * Stream that the lead is a member of, if the parent program is an engagement program
   */
  stream?: string
  /**
   * Datetime when the program was most recently updated
   */
  updatedAt: string
}
