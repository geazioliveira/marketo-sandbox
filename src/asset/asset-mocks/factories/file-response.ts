import { faker } from '@faker-js/faker'
import type { FileResponse } from '../../asset-definitions/responses/file-response'
import { makeFileFolder } from './file-folder'

export function makeFileResponse(
  overrides: Partial<FileResponse> = {},
): FileResponse {
  return {
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    folder: makeFileFolder(),
    id: faker.number.int({ min: 1, max: 99999 }),
    mimeType: faker.system.mimeType(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    size: faker.number.int({ min: 1, max: 1000 }),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    ...overrides,
  }
}
