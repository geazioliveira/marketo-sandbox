import { faker } from '@faker-js/faker'
import type { FileFolder } from '../../asset-definitions/models/file-folder'

export function makeFileFolder(
  overrides: Partial<FileFolder> = {},
): FileFolder {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.lorem.word(),
    ...overrides,
  }
}
