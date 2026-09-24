import { faker } from '@faker-js/faker'
import type { CreateFileRequest } from '../../asset-definitions/requests/create-file-request'
import { makeFolder } from './folder'

export function makeCreateFileRequest(
  overrides: Partial<CreateFileRequest> = {},
): CreateFileRequest {
  return {
    description: faker.lorem.sentence(),
    file: faker.lorem.word(),
    folder: makeFolder(),
    insertOnly: faker.datatype.boolean(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
