import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { UsedByResponse } from '../../asset-definitions/responses/used-by-response'
import { makePageDetailsDTO } from './page-details-dto'
import { makeUsedByItemDTO } from './used-by-item-dto'

export function makeUsedByResponse(
  overrides: Partial<UsedByResponse> = {},
): UsedByResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeUsedByItemDTO(), {
      count: { min: 1, max: 3 },
    }),
    pageDetails: makePageDetailsDTO(),
    ...overrides,
  }
}
