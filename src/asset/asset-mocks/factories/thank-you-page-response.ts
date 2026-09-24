import { faker } from '@faker-js/faker'
import type { ThankYouPageResponse } from '../../asset-definitions/responses/thank-you-page-response'
import { makeFormThankYouPageDTO } from './form-thank-you-page-dto'

export function makeThankYouPageResponse(
  overrides: Partial<ThankYouPageResponse> = {},
): ThankYouPageResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    thankYouList: faker.helpers.multiple(() => makeFormThankYouPageDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
