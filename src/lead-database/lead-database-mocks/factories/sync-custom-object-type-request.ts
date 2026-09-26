import { faker } from '@faker-js/faker'
import type { SyncCustomObjectTypeRequest } from '../../lead-database-definitions/requests/sync-custom-object-type-request'

export function makeSyncCustomObjectTypeRequest(
  overrides: Partial<SyncCustomObjectTypeRequest> = {},
): SyncCustomObjectTypeRequest {
  return {
    action: faker.helpers.arrayElement([
      'createOnly',
      'updateOnly',
      'createOrUpdate',
    ] as const),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    pluralName: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    showInLeadDetail: faker.datatype.boolean(),
    ...overrides,
  }
}
