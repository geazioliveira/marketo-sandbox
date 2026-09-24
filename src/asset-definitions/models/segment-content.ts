export interface SegmentContent {
  /**
   * Type of content section
   */
  content: Record<string, unknown>;
  followupType?: string;
  followupValue?: string;
  /**
   * Segmentation to which the section is linked
   */
  segmentId: number;
  /**
   * Name of the segment to display content section for
   */
  segmentName: string;
  /**
   * Type of content section
   */
  type: string;
}
