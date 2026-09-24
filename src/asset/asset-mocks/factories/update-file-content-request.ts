import { faker } from '@faker-js/faker'
import type { UpdateFileContentRequest } from '../../asset-definitions/requests/update-file-content-request'

export function makeUpdateFileContentRequest(
  overrides: Partial<UpdateFileContentRequest> = {},
): UpdateFileContentRequest {
  return {
    file: faker.lorem.word(),
    id: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
