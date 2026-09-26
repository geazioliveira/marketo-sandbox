import type { DateRange } from './date-range'

export interface ExportCustomObjectFilter {
  /**
   * Date range to filter updated custom objects on
   */
  updatedAt?: DateRange
  /**
   * Id of smart list to retrieve leads from
   */
  smartListId?: number
  /**
   * Name of smart list to retrieve leads from
   */
  smartListName?: string
  /**
   * Id of static list to retrieve leads from
   */
  staticListId?: number
  /**
   * Name of static list to retrieve leads from
   */
  staticListName?: string
}
