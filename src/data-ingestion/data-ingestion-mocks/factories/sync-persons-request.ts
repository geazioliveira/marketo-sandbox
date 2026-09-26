import { faker } from '@faker-js/faker'
import type { SyncPersonsRequest } from '../../data-ingestion-definitions/requests/sync-persons-request'
import { makeDedupeFields } from './dedupe-fields'
import { makePerson } from './person'

export function makeSyncPersonsRequest(
  overrides: Partial<SyncPersonsRequest> = {},
): SyncPersonsRequest {
  return {
    priority: faker.helpers.arrayElement(['normal', 'high'] as const),
    partitionName: faker.lorem.words({ min: 2, max: 3 }),
    dedupeFields: makeDedupeFields(),
    persons: faker.helpers.multiple(() => makePerson(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
