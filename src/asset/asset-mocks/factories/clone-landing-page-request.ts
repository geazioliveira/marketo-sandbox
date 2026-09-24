import { faker } from '@faker-js/faker'
import type { CloneLandingPageRequest } from '../../asset-definitions/requests/clone-landing-page-request'
import { makeFolder } from './folder'

export function makeCloneLandingPageRequest(
  overrides: Partial<CloneLandingPageRequest> = {},
): CloneLandingPageRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    template: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
