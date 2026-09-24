export interface UpdateLpTemplateRequest {
  /**
   * Description of the landing page template
   */
  description?: string
  /**
   * Whether to enable munchkin on the derived pages. Defaults to true
   */
  enableMunchkin?: boolean
  /**
   * Name of the landing page template
   */
  name?: string
}
