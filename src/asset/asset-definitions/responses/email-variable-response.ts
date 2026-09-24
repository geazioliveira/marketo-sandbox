export interface EmailVariableResponse {
  /**
   * Name of the email variable
   */
  name: string
  /**
   * Value of the email variable
   */
  value: string
  /**
   * Returns true for local variables else returns false
   */
  moduleScope: boolean
  /**
   * Returns the moduleId associated with the variable, only in case of local variable
   */
  moduleId?: string
}
