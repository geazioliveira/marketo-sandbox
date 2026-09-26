import type { Error } from '../models/error'
import type { LandingPageDomain } from '../models/landing-page-domain'

export interface ResponseOfLandingPageDomains {
  errors?: Array<Error>
  requestId?: string
  result?: Array<LandingPageDomain>
  success?: boolean
  warnings?: Array<string>
}
