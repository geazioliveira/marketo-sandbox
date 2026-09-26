import { faker } from '@faker-js/faker'
import type { SyncLeadRequest } from '../../lead-database-definitions/requests/sync-lead-request'
import { makeLead } from './lead'

export function makeSyncLeadRequest(
  overrides: Partial<SyncLeadRequest> = {},
): SyncLeadRequest {
  return {
    action: faker.helpers.arrayElement([
      'createOnly',
      'updateOnly',
      'createOrUpdate',
      'createDuplicate',
    ] as const),
    asyncProcessing: faker.datatype.boolean(),
    input: faker.helpers.multiple(() => makeLead(), {
      count: { min: 1, max: 3 },
    }),
    lookupField: faker.lorem.word(),
    partitionName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
