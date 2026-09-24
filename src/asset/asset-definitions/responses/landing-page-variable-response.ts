export interface LandingPageVariableResponse {
  /**
   * Integer id of the variable
   */
  id: string
  /**
   * Type of the variable
   */
  type?: string
  /**
   * Value of the variable
   */
  value?: Record<string, unknown>
}
