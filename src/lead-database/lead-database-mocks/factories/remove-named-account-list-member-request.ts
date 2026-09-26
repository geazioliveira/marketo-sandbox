import { faker } from '@faker-js/faker'
import type { RemoveNamedAccountListMemberRequest } from '../../lead-database-definitions/requests/remove-named-account-list-member-request'
import { makeNamedAccount } from './named-account'

export function makeRemoveNamedAccountListMemberRequest(
  overrides: Partial<RemoveNamedAccountListMemberRequest> = {},
): RemoveNamedAccountListMemberRequest {
  return {
    input: faker.helpers.multiple(() => makeNamedAccount(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
