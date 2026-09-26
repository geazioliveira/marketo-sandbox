import type { ErrorCount } from './error-count'

export interface ErrorsData {
  /**
   * Date of the collected calls
   */
  date: string
  /**
   * Counts for individual error codes
   */
  errors?: Array<ErrorCount>
  /**
   * Total number of errors in the time period
   */
  total?: number
}
