import type { Error } from '../models/error'
import type { SendSampleResponse } from './send-sample-response'

export interface ResponseOfSendSampleResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SendSampleResponse>
  success?: boolean
  warnings?: Array<string>
}
