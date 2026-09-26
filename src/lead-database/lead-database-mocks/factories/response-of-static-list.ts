import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfStaticList } from '../../lead-database-definitions/responses/response-of-static-list'
import { makeStaticList } from './static-list'

export function makeResponseOfStaticList(
  overrides: Partial<ResponseOfStaticList> = {},
): ResponseOfStaticList {
  return {
    errors: [],
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeStaticList(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
