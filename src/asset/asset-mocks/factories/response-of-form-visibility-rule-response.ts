import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfFormVisibilityRuleResponse } from '../../asset-definitions/responses/response-of-form-visibility-rule-response'
import { makeFormVisibilityRuleResponse } from './form-visibility-rule-response'

export function makeResponseOfFormVisibilityRuleResponse(
  overrides: Partial<ResponseOfFormVisibilityRuleResponse> = {},
): ResponseOfFormVisibilityRuleResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeFormVisibilityRuleResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
