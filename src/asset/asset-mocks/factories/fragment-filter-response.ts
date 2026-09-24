import { mockRequestId } from '../request-id'
import type { FragmentFilterResponse } from '../../asset-definitions/responses/fragment-filter-response'
import { makeFragmentFilterResult } from './fragment-filter-result'

export function makeFragmentFilterResponse(
  overrides: Partial<FragmentFilterResponse> = {},
): FragmentFilterResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    result: makeFragmentFilterResult(),
    ...overrides,
  }
}
