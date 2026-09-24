import type { Error } from '../models/error'
import type { GetLandingPageFullContentResponse } from './get-landing-page-full-content-response'

export interface ResponseOfGetLandingPageFullContentResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<GetLandingPageFullContentResponse>
  success?: boolean
  warnings?: Array<string>
}
