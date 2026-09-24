import { faker } from '@faker-js/faker'
import type { UpdateLandingPageRequest } from '../../asset-definitions/requests/update-landing-page-request'

export function makeUpdateLandingPageRequest(
  overrides: Partial<UpdateLandingPageRequest> = {},
): UpdateLandingPageRequest {
  return {
    customHeadHTML: faker.lorem.paragraph(),
    description: faker.lorem.sentence(),
    facebookOgTags: faker.lorem.word(),
    keywords: faker.lorem.word(),
    metaTagsDescription: faker.lorem.sentence(),
    mobileEnabled: faker.datatype.boolean(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    robots: faker.lorem.word(),
    styleOverRide: faker.lorem.word(),
    title: faker.lorem.words({ min: 2, max: 5 }),
    urlPageName: faker.internet.url(),
    ...overrides,
  }
}
