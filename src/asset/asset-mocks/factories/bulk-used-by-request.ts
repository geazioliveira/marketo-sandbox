import { faker } from '@faker-js/faker'
import type { BulkUsedByRequest } from '../../asset-definitions/requests/bulk-used-by-request'

export function makeBulkUsedByRequest(
  overrides: Partial<BulkUsedByRequest> = {},
): BulkUsedByRequest {
  return {
    assetIds: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
