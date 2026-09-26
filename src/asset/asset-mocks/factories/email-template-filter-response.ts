import { mockRequestId } from '../../../mocks/request-id'
import type { EmailTemplateFilterResponse } from '../../asset-definitions/responses/email-template-filter-response'
import { makeEmailTemplateFilterResult } from './email-template-filter-result'

export function makeEmailTemplateFilterResponse(
  overrides: Partial<EmailTemplateFilterResponse> = {},
): EmailTemplateFilterResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    result: makeEmailTemplateFilterResult(),
    ...overrides,
  }
}
