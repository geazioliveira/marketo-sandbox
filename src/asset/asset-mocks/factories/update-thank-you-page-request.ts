import { faker } from '@faker-js/faker'
import type { UpdateThankYouPageRequest } from '../../asset-definitions/requests/update-thank-you-page-request'
import { makeThankYouPageRequest } from './thank-you-page-request'

export function makeUpdateThankYouPageRequest(
  overrides: Partial<UpdateThankYouPageRequest> = {},
): UpdateThankYouPageRequest {
  return {
    thankyou: faker.helpers.multiple(() => makeThankYouPageRequest(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
