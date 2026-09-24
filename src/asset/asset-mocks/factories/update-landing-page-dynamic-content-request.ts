import { faker } from '@faker-js/faker'
import type { UpdateLandingPageDynamicContentRequest } from '../../asset-definitions/requests/update-landing-page-dynamic-content-request'

export function makeUpdateLandingPageDynamicContentRequest(
  overrides: Partial<UpdateLandingPageDynamicContentRequest> = {},
): UpdateLandingPageDynamicContentRequest {
  return {
    backgroundColor: faker.lorem.word(),
    borderColor: faker.lorem.word(),
    borderStyle: faker.lorem.word(),
    borderWidth: faker.lorem.word(),
    height: faker.lorem.word(),
    hideDesktop: faker.datatype.boolean(),
    hideMobile: faker.datatype.boolean(),
    imageOpenNewWindow: faker.lorem.word(),
    left: faker.lorem.word(),
    linkUrl: faker.internet.url(),
    opacity: faker.lorem.word(),
    segment: faker.lorem.word(),
    top: faker.lorem.word(),
    type: faker.lorem.word(),
    value: faker.lorem.word(),
    width: faker.lorem.word(),
    zIndex: faker.lorem.word(),
    ...overrides,
  }
}
