import type { Error } from '../models/error'
import type { LpTemplateResponse } from './lp-template-response'

export interface ResponseOfLpTemplateResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<LpTemplateResponse>
  success?: boolean
  warnings?: Array<string>
}
