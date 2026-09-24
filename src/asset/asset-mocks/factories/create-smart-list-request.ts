import { faker } from '@faker-js/faker'
import type { CreateSmartListRequest } from '../../asset-definitions/requests/create-smart-list-request'
import { makeFolder } from './folder'

export function makeCreateSmartListRequest(
  overrides: Partial<CreateSmartListRequest> = {},
): CreateSmartListRequest {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    folder: makeFolder(),
    description: faker.lorem.sentence(),
    ...overrides,
  }
}
