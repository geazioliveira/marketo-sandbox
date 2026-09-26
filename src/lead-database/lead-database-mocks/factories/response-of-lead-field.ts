import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfLeadField } from '../../lead-database-definitions/responses/response-of-lead-field'
import { makeLeadField } from './lead-field'

export function makeResponseOfLeadField(
  overrides: Partial<ResponseOfLeadField> = {},
): ResponseOfLeadField {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLeadField(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
