import { faker } from '@faker-js/faker'
import type { DeleteNamedAccountListRequest } from '../../lead-database-definitions/requests/delete-named-account-list-request'
import { makeNamedAccountList } from './named-account-list'

export function makeDeleteNamedAccountListRequest(
  overrides: Partial<DeleteNamedAccountListRequest> = {},
): DeleteNamedAccountListRequest {
  return {
    deleteBy: faker.lorem.word(),
    input: faker.helpers.multiple(() => makeNamedAccountList(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
