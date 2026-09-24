import type { EmailDynamicContentItem } from '../models/email-dynamic-content-item';

export interface EmailDynamicContentResponse {
  /**
   * List of variations in the section
   */
  content?: Array<EmailDynamicContentItem>;
  /**
   * Datetime when the section was created
   */
  createdAt?: string;
  /**
   * Id of the dnamic content section
   */
  id?: number;
  /**
   * Segmentation to which the section is linked
   */
  segmentation?: number;
  /**
   * Datetime when the section was last updated
   */
  updatedAt?: string;
}
