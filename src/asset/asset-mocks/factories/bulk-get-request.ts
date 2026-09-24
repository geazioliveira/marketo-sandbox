import { faker } from '@faker-js/faker'
import type { BulkGetRequest } from '../../asset-definitions/requests/bulk-get-request'

export function makeBulkGetRequest(
  overrides: Partial<BulkGetRequest> = {},
): BulkGetRequest {
  return {
    assetIds: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
