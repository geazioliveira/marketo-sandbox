import { faker } from '@faker-js/faker'
import type { SyncCustomObjectRequest } from '../../lead-database-definitions/requests/sync-custom-object-request'
import { makeCustomObject } from './custom-object'

export function makeSyncCustomObjectRequest(
  overrides: Partial<SyncCustomObjectRequest> = {},
): SyncCustomObjectRequest {
  return {
    action: faker.helpers.arrayElement([
      'createOnly',
      'updateOnly',
      'createOrUpdate',
    ] as const),
    dedupeBy: faker.lorem.word(),
    input: faker.helpers.multiple(() => makeCustomObject(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
