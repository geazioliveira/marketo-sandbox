import type { Error } from './error'
import type { LandingPageRedirectRule } from './landing-page-redirect-rule'

export interface ResponseOfLandingPageRedirectRules {
  errors?: Array<Error>
  requestId?: string
  result?: Array<LandingPageRedirectRule>
  success?: boolean
  warnings?: Array<string>
}
