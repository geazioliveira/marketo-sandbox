import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfPushLeadToMarketo } from '../../lead-database-definitions/responses/response-of-push-lead-to-marketo'
import { makeLead } from './lead'

export function makeResponseOfPushLeadToMarketo(
  overrides: Partial<ResponseOfPushLeadToMarketo> = {},
): ResponseOfPushLeadToMarketo {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLead(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
