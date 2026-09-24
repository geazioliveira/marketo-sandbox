import { faker } from '@faker-js/faker'
import type { CloneLpTemplateRequest } from '../../asset-definitions/requests/clone-lp-template-request'
import { makeFolder } from './folder'

export function makeCloneLpTemplateRequest(
  overrides: Partial<CloneLpTemplateRequest> = {},
): CloneLpTemplateRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
