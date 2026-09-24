export type RedirectToType = 'landingPageId' | 'url'

export interface RedirectTo {
  /**
   * Type of redirect landing page
   */
  type: RedirectToType
  /**
   * Value for redirect landing page
   */
  value: string
}
