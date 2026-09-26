import { faker } from '@faker-js/faker'
import type { DeleteCustomObjectRequest } from '../../lead-database-definitions/requests/delete-custom-object-request'
import { makeCustomObject } from './custom-object'

export function makeDeleteCustomObjectRequest(
  overrides: Partial<DeleteCustomObjectRequest> = {},
): DeleteCustomObjectRequest {
  return {
    deleteBy: faker.lorem.word(),
    input: faker.helpers.multiple(() => makeCustomObject(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
