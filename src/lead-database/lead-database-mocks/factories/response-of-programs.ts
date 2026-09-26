import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfPrograms } from '../../lead-database-definitions/responses/response-of-programs'
import { makeProgram } from './program'

export function makeResponseOfPrograms(
  overrides: Partial<ResponseOfPrograms> = {},
): ResponseOfPrograms {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeProgram(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
