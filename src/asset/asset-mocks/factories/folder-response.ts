import { faker } from '@faker-js/faker'
import type { FolderResponse } from '../../asset-definitions/responses/folder-response'
import { makeFolder } from './folder'

export function makeFolderResponse(
  overrides: Partial<FolderResponse> = {},
): FolderResponse {
  return {
    accessZoneId: faker.number.int({ min: 1, max: 99999 }),
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    folderId: makeFolder(),
    folderType: faker.helpers.arrayElement([
      'Email',
      'Email Batch Program',
      'Email Template',
      'Image',
      'Landing Page',
      'Landing Page Form',
      'Landing Page Template',
      'Marketing Event',
      'Marketing Folder',
      'Marketing Program',
      'Nurture Program',
      'Report',
      'Revenue Cycle Model',
      'Zone',
    ] as const),
    id: faker.number.int({ min: 1, max: 99999 }),
    isArchive: faker.datatype.boolean(),
    isSystem: faker.datatype.boolean(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    parent: makeFolder(),
    path: faker.lorem.word(),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    workspace: 'Default',
    ...overrides,
  }
}
