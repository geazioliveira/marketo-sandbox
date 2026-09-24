import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { EmailTemplateNewResponse } from '../../asset-definitions/responses/email-template-new-response'
import { makeEmailTemplateDetailDTO } from './email-template-detail-dto'

export function makeEmailTemplateNewResponse(
  overrides: Partial<EmailTemplateNewResponse> = {},
): EmailTemplateNewResponse {
  return {
    success: true,
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailTemplateDetailDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
