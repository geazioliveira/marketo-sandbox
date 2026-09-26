import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfActivityType } from '../../lead-database-definitions/responses/response-of-activity-type'
import { makeActivityType } from './activity-type'

export function makeResponseOfActivityType(
  overrides: Partial<ResponseOfActivityType> = {},
): ResponseOfActivityType {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeActivityType(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
