import { mockRequestId } from '../request-id'
import type { ErrorResponse } from '../../asset-definitions/responses/error-response'

export function makeErrorResponse(
  overrides: Partial<ErrorResponse> = {},
): ErrorResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    errors: [],
    ...overrides,
  }
}
