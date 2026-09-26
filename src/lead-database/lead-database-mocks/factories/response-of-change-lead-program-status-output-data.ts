import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfChangeLeadProgramStatusOutputData } from '../../lead-database-definitions/responses/response-of-change-lead-program-status-output-data'
import { makeChangeLeadProgramStatusOutputData } from './change-lead-program-status-output-data'

export function makeResponseOfChangeLeadProgramStatusOutputData(
  overrides: Partial<ResponseOfChangeLeadProgramStatusOutputData> = {},
): ResponseOfChangeLeadProgramStatusOutputData {
  return {
    errors: [],
    moreResult: faker.datatype.boolean(),
    nextPageToken: faker.lorem.word(),
    requestId: mockRequestId(),
    result: faker.helpers.multiple(
      () => makeChangeLeadProgramStatusOutputData(),
      { count: { min: 1, max: 3 } },
    ),
    success: true,
    warnings: [],
    ...overrides,
  }
}
