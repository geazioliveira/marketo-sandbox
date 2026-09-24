export type GetEmailFullContentResponseStatus = "approved" | "draft";

export interface GetEmailFullContentResponse {
  /**
   * HTML content of the email
   */
  content: string;
  /**
   * Unique integer id of the email
   */
  id: number;
  /**
   * Status filter for draft or approved versions
   */
  status: GetEmailFullContentResponseStatus;
}
