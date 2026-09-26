import { faker } from '@faker-js/faker'
import type { SyncCustomObjectsRequest } from '../../data-ingestion-definitions/requests/sync-custom-objects-request'
import { makeCustomObject } from './custom-object'

export function makeSyncCustomObjectsRequest(
  overrides: Partial<SyncCustomObjectsRequest> = {},
): SyncCustomObjectsRequest {
  return {
    priority: faker.helpers.arrayElement(['normal', 'high'] as const),
    dedupeBy: faker.helpers.arrayElement([
      'dedupeFields',
      'marketoGUID',
    ] as const),
    customObjects: faker.helpers.multiple(() => makeCustomObject(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
