import { mockRequestId } from '../request-id'
import type { EmailFilterResponse } from '../../asset-definitions/responses/email-filter-response'
import { makeEmailFilterResult } from './email-filter-result'

export function makeEmailFilterResponse(
  overrides: Partial<EmailFilterResponse> = {},
): EmailFilterResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    result: makeEmailFilterResult(),
    ...overrides,
  }
}
