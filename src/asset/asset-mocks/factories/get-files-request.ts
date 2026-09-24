import { faker } from '@faker-js/faker'
import type { GetFilesRequest } from '../../asset-definitions/requests/get-files-request'
import { makeFolder } from './folder'

export function makeGetFilesRequest(
  overrides: Partial<GetFilesRequest> = {},
): GetFilesRequest {
  return {
    folder: makeFolder(),
    maxReturn: faker.number.int({ min: 1, max: 1000 }),
    offset: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
