import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfCustomActivity } from '../../lead-database-definitions/responses/response-of-custom-activity'
import { makeCustomActivity } from './custom-activity'

export function makeResponseOfCustomActivity(
  overrides: Partial<ResponseOfCustomActivity> = {},
): ResponseOfCustomActivity {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeCustomActivity(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
