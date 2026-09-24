import { faker } from '@faker-js/faker'
import type { CloneSmartListRequest } from '../../asset-definitions/requests/clone-smart-list-request'
import { makeFolder } from './folder'

export function makeCloneSmartListRequest(
  overrides: Partial<CloneSmartListRequest> = {},
): CloneSmartListRequest {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    folder: makeFolder(),
    description: faker.lorem.sentence(),
    ...overrides,
  }
}
