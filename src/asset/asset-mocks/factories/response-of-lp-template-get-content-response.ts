import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfLpTemplateGetContentResponse } from '../../asset-definitions/responses/response-of-lp-template-get-content-response'
import { makeLpTemplateGetContentResponse } from './lp-template-get-content-response'

export function makeResponseOfLpTemplateGetContentResponse(
  overrides: Partial<ResponseOfLpTemplateGetContentResponse> = {},
): ResponseOfLpTemplateGetContentResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLpTemplateGetContentResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
