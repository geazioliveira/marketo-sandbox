import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfLeadAttribute2 } from '../../lead-database-definitions/responses/response-of-lead-attribute2'
import { makeLeadAttribute2 } from './lead-attribute2'

export function makeResponseOfLeadAttribute2(
  overrides: Partial<ResponseOfLeadAttribute2> = {},
): ResponseOfLeadAttribute2 {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLeadAttribute2(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
