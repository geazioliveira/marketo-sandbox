import type { Error } from '../models/error'
import type { SmartListRuleTypes } from '../models/smart-list-rule-types'

export interface ResponseOfSmartListRuleType {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SmartListRuleTypes>
  success?: boolean
  warnings?: Array<string>
}
