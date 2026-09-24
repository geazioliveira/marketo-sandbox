import { faker } from '@faker-js/faker'
import type { LandingPageResponse } from '../../asset-definitions/responses/landing-page-response'
import { makeFolder } from './folder'

export function makeLandingPageResponse(
  overrides: Partial<LandingPageResponse> = {},
): LandingPageResponse {
  return {
    URL: faker.internet.url(),
    computedUrl: faker.internet.url(),
    destinationUrl: faker.internet.url(),
    createdAt: faker.date.recent().toISOString(),
    customHeadHTML: faker.lorem.paragraph(),
    description: faker.lorem.sentence(),
    facebookOgTags: faker.lorem.word(),
    folder: makeFolder(),
    formPrefill: faker.datatype.boolean(),
    id: faker.number.int({ min: 1, max: 99999 }),
    keywords: faker.lorem.word(),
    mobileEnabled: faker.datatype.boolean(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    robots: faker.lorem.word(),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    template: faker.number.int({ min: 1, max: 1000 }),
    title: faker.lorem.words({ min: 2, max: 5 }),
    updatedAt: faker.date.recent().toISOString(),
    workspace: 'Default',
    ...overrides,
  }
}
