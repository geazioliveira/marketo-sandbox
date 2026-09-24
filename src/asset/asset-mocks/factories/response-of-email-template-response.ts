import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfEmailTemplateResponse } from '../../asset-definitions/responses/response-of-email-template-response'
import { makeEmailTemplateResponse } from './email-template-response'

export function makeResponseOfEmailTemplateResponse(
  overrides: Partial<ResponseOfEmailTemplateResponse> = {},
): ResponseOfEmailTemplateResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailTemplateResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
