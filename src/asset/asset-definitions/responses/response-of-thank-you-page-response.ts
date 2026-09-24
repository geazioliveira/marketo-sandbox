import type { Error } from '../models/error'
import type { ThankYouPageResponse } from './thank-you-page-response'

export interface ResponseOfThankYouPageResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<ThankYouPageResponse>
  success?: boolean
  warnings?: Array<string>
}
