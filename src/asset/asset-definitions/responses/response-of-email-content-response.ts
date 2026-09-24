import type { EmailContentResponse } from './email-content-response'
import type { Error } from '../models/error'

export interface ResponseOfEmailContentResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<EmailContentResponse>
  success?: boolean
  warnings?: Array<string>
}
