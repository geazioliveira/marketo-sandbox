import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfLpTemplateResponse } from '../../asset-definitions/responses/response-of-lp-template-response'
import { makeLpTemplateResponse } from './lp-template-response'

export function makeResponseOfLpTemplateResponse(
  overrides: Partial<ResponseOfLpTemplateResponse> = {},
): ResponseOfLpTemplateResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLpTemplateResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
