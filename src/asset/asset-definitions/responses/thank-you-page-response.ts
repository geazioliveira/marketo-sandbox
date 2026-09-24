import type { FormThankYouPageDTO } from '../models/form-thank-you-page-dto'

export interface ThankYouPageResponse {
  id?: number
  thankYouList?: Array<FormThankYouPageDTO>
}
