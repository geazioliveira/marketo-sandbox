import { mockRequestId } from '../request-id'
import type { DeleteResponse } from '../../asset-definitions/responses/delete-response'

export function makeDeleteResponse(
  overrides: Partial<DeleteResponse> = {},
): DeleteResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    ...overrides,
  }
}
