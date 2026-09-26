import type { Error } from '../models/error'
import type { LandingPageRedirectRule } from '../models/landing-page-redirect-rule'

export interface ResponseOfLandingPageRedirectRules {
  errors?: Array<Error>
  requestId?: string
  result?: Array<LandingPageRedirectRule>
  success?: boolean
  warnings?: Array<string>
}
