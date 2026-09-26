import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { BulkUsedByResponse } from '../../asset-definitions/responses/bulk-used-by-response'
import { makeBulkUsedByItemDTO } from './bulk-used-by-item-dto'

export function makeBulkUsedByResponse(
  overrides: Partial<BulkUsedByResponse> = {},
): BulkUsedByResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeBulkUsedByItemDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
