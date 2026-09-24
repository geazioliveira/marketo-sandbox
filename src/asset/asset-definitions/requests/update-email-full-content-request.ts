export interface UpdateEmailFullContentRequest {
  /**
   * Multipart file. File containing HTML document to update with. File cannot include JavaScript or script tags.
   */
  content: string
}
