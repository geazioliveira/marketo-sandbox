import type { EmailVariableResponse } from './email-variable-response'
import type { Error } from '../models/error'

export interface ResponseOfEmailVariableResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<EmailVariableResponse>
  success?: boolean
  warnings?: Array<string>
}
