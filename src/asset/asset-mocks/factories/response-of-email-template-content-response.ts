import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfEmailTemplateContentResponse } from '../../asset-definitions/responses/response-of-email-template-content-response'
import { makeEmailTemplateContentResponse } from './email-template-content-response'

export function makeResponseOfEmailTemplateContentResponse(
  overrides: Partial<ResponseOfEmailTemplateContentResponse> = {},
): ResponseOfEmailTemplateContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailTemplateContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
