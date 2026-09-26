import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfObjectMetaData } from '../../lead-database-definitions/responses/response-of-object-meta-data'
import { makeObjectMetaData } from './object-meta-data'

export function makeResponseOfObjectMetaData(
  overrides: Partial<ResponseOfObjectMetaData> = {},
): ResponseOfObjectMetaData {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeObjectMetaData(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
