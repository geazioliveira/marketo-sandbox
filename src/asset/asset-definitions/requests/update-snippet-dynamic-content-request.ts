export type UpdateSnippetDynamicContentRequestType =
  "Typeofcontent.Either'HTML'or'Text'"

export interface UpdateSnippetDynamicContentRequest {
  /**
   * Type of dynamic content section
   */
  type?: UpdateSnippetDynamicContentRequestType
  /**
   * Value of the dynamic content section
   */
  value?: string
}
