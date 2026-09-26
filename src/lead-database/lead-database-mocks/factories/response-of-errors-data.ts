import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfErrorsData } from '../../lead-database-definitions/responses/response-of-errors-data'
import { makeErrorsData } from './errors-data'

export function makeResponseOfErrorsData(
  overrides: Partial<ResponseOfErrorsData> = {},
): ResponseOfErrorsData {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeErrorsData(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
