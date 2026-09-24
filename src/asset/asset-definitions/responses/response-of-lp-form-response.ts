import type { Error } from '../models/error'
import type { LpFormResponse } from './lp-form-response'

export interface ResponseOfLpFormResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<LpFormResponse>
  success?: boolean
  warnings?: Array<string>
}
