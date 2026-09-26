export interface LeadChangeField {
  /**
   * Unique integer id of the change record
   */
  id: number
  /**
   * Name of the field which was changed
   */
  name: string
  /**
   * New value after the change
   */
  newValue: string
  /**
   * Old value before the change
   */
  oldValue?: string
}
