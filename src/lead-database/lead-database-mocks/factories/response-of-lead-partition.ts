import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfLeadPartition } from '../../lead-database-definitions/responses/response-of-lead-partition'
import { makeLeadPartition } from './lead-partition'

export function makeResponseOfLeadPartition(
  overrides: Partial<ResponseOfLeadPartition> = {},
): ResponseOfLeadPartition {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLeadPartition(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
