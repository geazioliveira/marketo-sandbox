import type { EmailTemplateResponse } from './email-template-response'
import type { Error } from '../models/error'

export interface ResponseOfEmailTemplateResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<EmailTemplateResponse>
  success?: boolean
  warnings?: Array<string>
}
