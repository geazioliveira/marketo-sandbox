import type { Error } from '../models/error'
import type { LpTemplateGetContentResponse } from './lp-template-get-content-response'

export interface ResponseOfLpTemplateGetContentResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<LpTemplateGetContentResponse>
  success?: boolean
  warnings?: Array<string>
}
