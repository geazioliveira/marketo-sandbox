import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfActivity } from '../../lead-database-definitions/responses/response-of-activity'
import { makeActivity } from './activity'

export function makeResponseOfActivity(
  overrides: Partial<ResponseOfActivity> = {},
): ResponseOfActivity {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeActivity(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
