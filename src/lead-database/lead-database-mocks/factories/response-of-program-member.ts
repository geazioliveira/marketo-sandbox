import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfProgramMember } from '../../lead-database-definitions/responses/response-of-program-member'
import { makeProgramMember } from './program-member'

export function makeResponseOfProgramMember(
  overrides: Partial<ResponseOfProgramMember> = {},
): ResponseOfProgramMember {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeProgramMember(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
