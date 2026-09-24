import { faker } from '@faker-js/faker'
import type { CloneProgramRequest } from '../../asset-definitions/requests/clone-program-request'
import { makeFolder } from './folder'

export function makeCloneProgramRequest(
  overrides: Partial<CloneProgramRequest> = {},
): CloneProgramRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
