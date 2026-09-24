import { faker } from '@faker-js/faker'
import type { FolderContentResponse } from '../../asset-definitions/responses/folder-content-response'

export function makeFolderContentResponse(
  overrides: Partial<FolderContentResponse> = {},
): FolderContentResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    type: faker.lorem.word(),
    ...overrides,
  }
}
