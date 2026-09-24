import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { FragmentNewResponse } from '../../asset-definitions/responses/fragment-new-response'
import { makeFragmentDetailDTO } from './fragment-detail-dto'

export function makeFragmentNewResponse(
  overrides: Partial<FragmentNewResponse> = {},
): FragmentNewResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeFragmentDetailDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
