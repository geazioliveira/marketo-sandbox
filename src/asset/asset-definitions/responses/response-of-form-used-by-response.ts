import type { Error } from '../models/error'
import type { FormUsedByResponse } from './form-used-by-response'

export interface ResponseOfFormUsedByResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<FormUsedByResponse>
  success?: boolean
  warnings?: Array<string>
}
