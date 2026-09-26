import { faker } from '@faker-js/faker'
import type { SyncCompaniesRequest } from '../../data-ingestion-definitions/requests/sync-companies-request'
import { makeCompany } from './company'

export function makeSyncCompaniesRequest(
  overrides: Partial<SyncCompaniesRequest> = {},
): SyncCompaniesRequest {
  return {
    action: faker.helpers.arrayElement([
      'createOnly',
      'updateOnly',
      'createOrUpdate',
    ] as const),
    dedupeBy: faker.helpers.arrayElement(['dedupeFields', 'idField'] as const),
    input: faker.helpers.multiple(() => makeCompany(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
