import { faker } from '@faker-js/faker'
import type { CreateStaticListRequest } from '../../asset-definitions/requests/create-static-list-request'
import { makeFolder } from './folder'

export function makeCreateStaticListRequest(
  overrides: Partial<CreateStaticListRequest> = {},
): CreateStaticListRequest {
  return {
    description: faker.lorem.sentence(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    folder: makeFolder(),
    ...overrides,
  }
}
