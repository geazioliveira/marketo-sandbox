import type { Error } from '../models/error'
import type { GetEmailFullContentResponse } from './get-email-full-content-response'

export interface ResponseOfGetEmailFullContentResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<GetEmailFullContentResponse>
  success?: boolean
  warnings?: Array<string>
}
