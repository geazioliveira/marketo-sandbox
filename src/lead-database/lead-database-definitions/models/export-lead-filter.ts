import type { DateRange } from './date-range'

export interface ExportLeadFilter {
  /**
   * Date range to filter new leads on
   */
  createdAt?: DateRange
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
  /**
   * Date range to filter updated leads on
   */
  updatedAt?: DateRange
}
