import { faker } from '@faker-js/faker'
import type { Folder } from '../../asset-definitions/models/folder'

export function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    type: faker.helpers.arrayElement(['Folder', 'Program'] as const),
    ...overrides,
  }
}
