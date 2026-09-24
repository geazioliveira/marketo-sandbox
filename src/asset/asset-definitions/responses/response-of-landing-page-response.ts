import type { Error } from '../models/error'
import type { LandingPageResponse } from './landing-page-response'

export interface ResponseOfLandingPageResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<LandingPageResponse>
  success?: boolean
  warnings?: Array<string>
}
