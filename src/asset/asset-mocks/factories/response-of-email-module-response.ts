import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfEmailModuleResponse } from '../../asset-definitions/responses/response-of-email-module-response'
import { makeEmailModuleResponse } from './email-module-response'

export function makeResponseOfEmailModuleResponse(
  overrides: Partial<ResponseOfEmailModuleResponse> = {},
): ResponseOfEmailModuleResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeEmailModuleResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
