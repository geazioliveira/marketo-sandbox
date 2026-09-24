import { faker } from '@faker-js/faker'
import { mockRequestId } from '../request-id'
import type { ResponseOfSmartListResponseWithRules } from '../../asset-definitions/models/response-of-smart-list-response-with-rules'
import { makeSmartListResponseWithRules } from './smart-list-response-with-rules'

export function makeResponseOfSmartListResponseWithRules(
  overrides: Partial<ResponseOfSmartListResponseWithRules> = {},
): ResponseOfSmartListResponseWithRules {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartListResponseWithRules(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
