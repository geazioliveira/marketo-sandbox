import type { Error } from '../models/error'
import type { LandingPageVariableResponse } from './landing-page-variable-response'

export interface ResponseOfLandingPageVariableResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<LandingPageVariableResponse>
  success?: boolean
  warnings?: Array<string>
}
