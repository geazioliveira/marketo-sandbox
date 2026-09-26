import { faker } from '@faker-js/faker'
import type { DeleteNamedAccountRequest } from '../../lead-database-definitions/requests/delete-named-account-request'
import { makeNamedAccount } from './named-account'

export function makeDeleteNamedAccountRequest(
  overrides: Partial<DeleteNamedAccountRequest> = {},
): DeleteNamedAccountRequest {
  return {
    deleteBy: faker.lorem.word(),
    input: faker.helpers.multiple(() => makeNamedAccount(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
