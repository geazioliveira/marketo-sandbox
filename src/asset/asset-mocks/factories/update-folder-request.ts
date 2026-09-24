import { faker } from '@faker-js/faker'
import type { UpdateFolderRequest } from '../../asset-definitions/requests/update-folder-request'

export function makeUpdateFolderRequest(
  overrides: Partial<UpdateFolderRequest> = {},
): UpdateFolderRequest {
  return {
    description: faker.lorem.sentence(),
    isArchive: faker.datatype.boolean(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.helpers.arrayElement(['Folder', 'Program'] as const),
    ...overrides,
  }
}
