import { faker } from '@faker-js/faker'
import type { CloneFormRequest } from '../../asset-definitions/requests/clone-form-request'
import { makeFolder } from './folder'

export function makeCloneFormRequest(
  overrides: Partial<CloneFormRequest> = {},
): CloneFormRequest {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    folder: makeFolder(),
    description: faker.lorem.sentence(),
    ...overrides,
  }
}
