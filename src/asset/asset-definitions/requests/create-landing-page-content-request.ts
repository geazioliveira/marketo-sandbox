export type CreateLandingPageContentRequestType =
  'Image' | 'Form' | 'Rectangle' | 'Snippet' | 'RichText' | 'HTML'

export interface CreateLandingPageContentRequest {
  /**
   * background-color property of the HTML section
   */
  backgroundColor?: string
  /**
   * border-color property of the HTML section
   */
  borderColor?: string
  /**
   * border-style property of the HTML section
   */
  borderStyle?: string
  /**
   * border-width property of the HTML section
   */
  borderWidth?: string
  /**
   * Id of the content section. Also the HTML id of the section.
   */
  contentId: string
  /**
   * height property of the HTML section
   */
  height?: string
  /**
   * Hide the section when displayed on a desktop browser. Default false
   */
  hideDesktop?: boolean
  /**
   * Hide the section when displayed on a mobile browser. Default false
   */
  hideMobile?: boolean
  imageOpenNewWindow?: string
  /**
   * left property of the HTML section
   */
  left?: string
  /**
   * URL parameter of a link type section
   */
  linkUrl?: string
  /**
   * opacity property of the HTML section
   */
  opacity?: string
  /**
   * top property of the HTML section
   */
  top?: string
  /**
   * Type of content section
   */
  type: CreateLandingPageContentRequestType
  /**
   * Type of content section
   */
  value?: string
  /**
   * width property of the HTML section
   */
  width?: string
  /**
   * z-index property of the HTML section
   */
  zIndex?: string
}
