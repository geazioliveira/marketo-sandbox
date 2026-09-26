import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfCustomObject } from '../../lead-database-definitions/responses/response-of-custom-object'
import { makeCustomObject } from './custom-object'

export function makeResponseOfCustomObject(
  overrides: Partial<ResponseOfCustomObject> = {},
): ResponseOfCustomObject {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeCustomObject(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
