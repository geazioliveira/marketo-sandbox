import type { ThankYouPageRequest } from './thank-you-page-request'

export interface UpdateThankYouPageRequest {
  /**
   * JSON array of followup rules
   */
  thankyou?: Array<ThankYouPageRequest>
}
