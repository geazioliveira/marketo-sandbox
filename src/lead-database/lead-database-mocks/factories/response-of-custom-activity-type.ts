import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfCustomActivityType } from '../../lead-database-definitions/responses/response-of-custom-activity-type'
import { makeCustomActivityType } from './custom-activity-type'

export function makeResponseOfCustomActivityType(
  overrides: Partial<ResponseOfCustomActivityType> = {},
): ResponseOfCustomActivityType {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeCustomActivityType(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
