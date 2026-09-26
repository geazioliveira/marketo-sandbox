import type { Error } from '../models/error'
import type { SmartListResponseWithRules } from '../models/smart-list-response-with-rules'

export interface ResponseOfSmartListResponseWithRules {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartListResponseWithRules>
  success?: boolean
  warnings?: Array<string>
}
