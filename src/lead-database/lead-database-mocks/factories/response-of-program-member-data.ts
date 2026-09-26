import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfProgramMemberData } from '../../lead-database-definitions/responses/response-of-program-member-data'
import { makeProgramMemberStatusResponse } from './program-member-status-response'

export function makeResponseOfProgramMemberData(
  overrides: Partial<ResponseOfProgramMemberData> = {},
): ResponseOfProgramMemberData {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeProgramMemberStatusResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
