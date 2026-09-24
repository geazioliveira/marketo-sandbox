import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfEmailTemplateUsedByResponse } from '../../asset-definitions/responses/response-of-email-template-used-by-response'
import { makeEmailTemplateUsedByResponse } from './email-template-used-by-response'

export function makeResponseOfEmailTemplateUsedByResponse(
  overrides: Partial<ResponseOfEmailTemplateUsedByResponse> = {},
): ResponseOfEmailTemplateUsedByResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailTemplateUsedByResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
