export type LpTemplateGetContentResponseStatus = 'approved' | 'draft'
export type LpTemplateGetContentResponseTemplateType = 'guided' | 'freeForm'

export interface LpTemplateGetContentResponse {
  /**
   * HTML content of the landing page template
   */
  content: string
  /**
   * Whether to enable munchkin on the derived pages. Defaults to true
   */
  enableMunchkin: boolean
  /**
   * Unique integer id of the template
   */
  id: number
  /**
   * Status filter for draft or approved versions
   */
  status: LpTemplateGetContentResponseStatus
  /**
   * Type of template to create. Defaults to freeForm
   */
  templateType: LpTemplateGetContentResponseTemplateType
}
