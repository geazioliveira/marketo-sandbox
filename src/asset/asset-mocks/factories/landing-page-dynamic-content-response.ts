import { faker } from '@faker-js/faker'
import type { LandingPageDynamicContentResponse } from '../../asset-definitions/responses/landing-page-dynamic-content-response'
import { makeSegmentContent } from './segment-content'

export function makeLandingPageDynamicContentResponse(
  overrides: Partial<LandingPageDynamicContentResponse> = {},
): LandingPageDynamicContentResponse {
  return {
    content: faker.helpers.multiple(() => makeSegmentContent(), {
      count: { min: 1, max: 3 },
    }),
    createdAt: faker.date.recent().toISOString(),
    id: faker.number.int({ min: 1, max: 99999 }),
    segmentation: faker.number.int({ min: 1, max: 1000 }),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
