import { faker } from '@faker-js/faker'
import type { CloneEmailRequest } from '../../asset-definitions/requests/clone-email-request'
import { makeFolder } from './folder'

export function makeCloneEmailRequest(
  overrides: Partial<CloneEmailRequest> = {},
): CloneEmailRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    operational: faker.datatype.boolean(),
    ...overrides,
  }
}
