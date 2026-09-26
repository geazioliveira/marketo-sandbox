import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfCreateLeadField } from '../../lead-database-definitions/responses/response-of-create-lead-field'
import { makeLeadFieldStatus } from './lead-field-status'

export function makeResponseOfCreateLeadField(
  overrides: Partial<ResponseOfCreateLeadField> = {},
): ResponseOfCreateLeadField {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeLeadFieldStatus(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
