import type { UserCount } from './user-count'

export interface UsageData {
  /**
   * Date of the collected calls
   */
  date: string
  /**
   * Total number of calls in the time period
   */
  total?: number
  /**
   * Counts for individual users
   */
  users?: Array<UserCount>
}
