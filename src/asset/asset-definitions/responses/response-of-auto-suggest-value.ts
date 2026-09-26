import type { AutoSuggestValue } from '../models/auto-suggest-value'
import type { Error } from '../models/error'

export interface ResponseOfAutoSuggestValue {
  errors?: Array<Error>
  requestId?: string
  /**
   * One array of suggested values
   */
  result?: Array<Array<AutoSuggestValue>>
  success?: boolean
  warnings?: Array<string>
}
