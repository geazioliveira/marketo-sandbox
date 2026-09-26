import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfProgramMemberAttributes2 } from '../../lead-database-definitions/responses/response-of-program-member-attributes2'
import { makeProgramMemberAttribute2 } from './program-member-attribute2'

export function makeResponseOfProgramMemberAttributes2(
  overrides: Partial<ResponseOfProgramMemberAttributes2> = {},
): ResponseOfProgramMemberAttributes2 {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeProgramMemberAttribute2(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
