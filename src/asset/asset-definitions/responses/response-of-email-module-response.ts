import type { EmailModuleResponse } from './email-module-response'
import type { Error } from '../models/error'

export interface ResponseOfEmailModuleResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<EmailModuleResponse>
  success?: boolean
  warnings?: Array<string>
}
