import { faker } from '@faker-js/faker'
import type { LandingPageVariableResponse } from '../../asset-definitions/responses/landing-page-variable-response'

export function makeLandingPageVariableResponse(
  overrides: Partial<LandingPageVariableResponse> = {},
): LandingPageVariableResponse {
  return {
    id: faker.lorem.word(),
    type: faker.lorem.word(),
    value: {},
    ...overrides,
  }
}
