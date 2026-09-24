export type FormUsedByResponseStatus = "approved" | "draft";

export interface FormUsedByResponse {
  /**
   * Id of the asset
   */
  id: number;
  /**
   * Name of the asset
   */
  name: string;
  /**
   * Type of asset
   */
  type: string;
  /**
   * Status filter for draft or approved versions
   */
  status: FormUsedByResponseStatus;
  /**
   * Datetime the asset was most recently updated
   */
  updatedAt: string;
}
