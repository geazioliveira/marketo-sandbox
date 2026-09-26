import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfSmartListRuleType } from '../../asset-definitions/responses/response-of-smart-list-rule-type'
import { makeSmartListRuleTypes } from './smart-list-rule-types'

export function makeResponseOfSmartListRuleType(
  overrides: Partial<ResponseOfSmartListRuleType> = {},
): ResponseOfSmartListRuleType {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeSmartListRuleTypes(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
