export type EmailTemplateContentResponseStatus = 'approved' | 'draft'

export interface EmailTemplateContentResponse {
  /**
   * HTML content of the template
   */
  content: string
  /**
   * Unique integer id of the email template
   */
  id: number
  /**
   * Status filter for draft or approved versions
   */
  status: EmailTemplateContentResponseStatus
}
