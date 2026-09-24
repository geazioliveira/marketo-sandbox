import type { SegmentContent } from '../models/segment-content';

export interface LandingPageDynamicContentResponse {
  /**
   * List of variations in the section
   */
  content?: Array<SegmentContent>;
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
