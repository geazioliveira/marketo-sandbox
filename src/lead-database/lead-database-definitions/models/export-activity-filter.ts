import type { DateRange } from './date-range'

export interface ExportActivityFilter {
  /**
   * List of activity type ids to filter on
   */
  activityTypeIds?: Array<number>
  /**
   * List of primary attribute ids to filter on
   */
  primaryAttributeValueIds?: Array<number>
  /**
   * List of primary attribute values to filter on
   */
  primaryAttributeValues?: Array<string>
  /**
   * Date range to filter new activities on
   */
  createdAt: DateRange
}
