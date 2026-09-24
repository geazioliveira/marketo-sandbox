import type { EmailTemplateUsedByResponse } from './email-template-used-by-response'
import type { Error } from '../models/error'

export interface ResponseOfEmailTemplateUsedByResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<EmailTemplateUsedByResponse>
  success?: boolean
  warnings?: Array<string>
}
