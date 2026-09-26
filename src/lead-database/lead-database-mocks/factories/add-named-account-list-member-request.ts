import { faker } from '@faker-js/faker'
import type { AddNamedAccountListMemberRequest } from '../../lead-database-definitions/requests/add-named-account-list-member-request'
import { makeNamedAccount } from './named-account'

export function makeAddNamedAccountListMemberRequest(
  overrides: Partial<AddNamedAccountListMemberRequest> = {},
): AddNamedAccountListMemberRequest {
  return {
    input: faker.helpers.multiple(() => makeNamedAccount(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
