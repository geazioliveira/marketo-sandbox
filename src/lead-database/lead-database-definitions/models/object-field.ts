export interface ObjectField {
  /**
   * Datatype of the field
   */
  dataType?: string
  /**
   * UI display-name of the field
   */
  displayName?: string
  /**
   * Max length of the field. Only applicable to text, string, and text area.
   */
  length?: number
  /**
   * Name of the field
   */
  name?: string
  /**
   * Whether the field is updateable
   */
  updateable?: boolean
  /**
   * Whether the field is managed by CRM (native sync)
   */
  crmManaged?: boolean
}
