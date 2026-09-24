import { faker } from '@faker-js/faker'
import type { CreateFolderRequest } from '../../asset-definitions/requests/create-folder-request'
import { makeFolder } from './folder'

export function makeCreateFolderRequest(
  overrides: Partial<CreateFolderRequest> = {},
): CreateFolderRequest {
  return {
    description: faker.lorem.sentence(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    parent: makeFolder(),
    ...overrides,
  }
}
