import { faker } from '@faker-js/faker'
import type { SyncNamedAccountRequest } from '../../lead-database-definitions/requests/sync-named-account-request'
import { makeNamedAccount } from './named-account'

export function makeSyncNamedAccountRequest(
  overrides: Partial<SyncNamedAccountRequest> = {},
): SyncNamedAccountRequest {
  return {
    action: faker.helpers.arrayElement([
      'createOnly',
      'updateOnly',
      'createOrUpdate',
    ] as const),
    dedupeBy: faker.lorem.word(),
    input: faker.helpers.multiple(() => makeNamedAccount(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
