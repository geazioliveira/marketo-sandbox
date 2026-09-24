import { faker } from '@faker-js/faker'
import type { GetLandingPageFullContentResponse } from '../../asset-definitions/responses/get-landing-page-full-content-response'

export function makeGetLandingPageFullContentResponse(
  overrides: Partial<GetLandingPageFullContentResponse> = {},
): GetLandingPageFullContentResponse {
  return {
    content: faker.lorem.paragraph(),
    id: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
