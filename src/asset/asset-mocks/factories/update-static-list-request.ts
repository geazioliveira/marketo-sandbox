import { faker } from '@faker-js/faker'
import type { UpdateStaticListRequest } from '../../asset-definitions/requests/update-static-list-request'

export function makeUpdateStaticListRequest(
  overrides: Partial<UpdateStaticListRequest> = {},
): UpdateStaticListRequest {
  return {
    description: faker.lorem.sentence(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
