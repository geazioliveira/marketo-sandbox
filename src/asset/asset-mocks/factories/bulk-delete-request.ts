import { faker } from '@faker-js/faker'
import type { BulkDeleteRequest } from '../../asset-definitions/requests/bulk-delete-request'

export function makeBulkDeleteRequest(
  overrides: Partial<BulkDeleteRequest> = {},
): BulkDeleteRequest {
  return {
    assetIds: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ignoreUsedBy: faker.datatype.boolean(),
    ...overrides,
  }
}
