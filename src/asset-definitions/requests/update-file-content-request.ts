export interface UpdateFileContentRequest {
  /**
   * Multipart file. Content of the file.
   */
  file: string;
  /**
   * Id of the file
   */
  id: number;
}
