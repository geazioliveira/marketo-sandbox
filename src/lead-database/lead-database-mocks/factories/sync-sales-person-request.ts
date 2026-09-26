import { faker } from '@faker-js/faker'
import type { SyncSalesPersonRequest } from '../../lead-database-definitions/requests/sync-sales-person-request'
import { makeSalesPerson } from './sales-person'

export function makeSyncSalesPersonRequest(
  overrides: Partial<SyncSalesPersonRequest> = {},
): SyncSalesPersonRequest {
  return {
    action: faker.helpers.arrayElement([
      'createOnly',
      'updateOnly',
      'createOrUpdate',
    ] as const),
    dedupeBy: faker.lorem.word(),
    input: faker.helpers.multiple(() => makeSalesPerson(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
