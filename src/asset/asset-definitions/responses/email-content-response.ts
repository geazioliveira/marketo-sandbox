export interface EmailContentResponse {
  /**
   * Type of content to set for the section.
   */
  contentType: string
  /**
   * HTML id of the content section
   */
  htmlId: string
  index?: number
  isLocked?: boolean
  parentHtmlId?: string
  /**
   * Contents of the section
   */
  value: Record<string, unknown>
}
