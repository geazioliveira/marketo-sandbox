import { faker } from '@faker-js/faker'
import type { SnippetFolder } from '../../asset-definitions/models/snippet-folder'

export function makeSnippetFolder(
  overrides: Partial<SnippetFolder> = {},
): SnippetFolder {
  return {
    value: faker.number.int({ min: 1, max: 1000 }),
    type: faker.helpers.arrayElement(['Folder', 'Program'] as const),
    folderName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
