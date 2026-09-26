import { faker } from '@faker-js/faker'
import { mockRequestId } from '../../../mocks/request-id'
import type { ResponseOfImportProgramMemberResponse } from '../../lead-database-definitions/responses/response-of-import-program-member-response'
import { makeImportProgramMemberResponse } from './import-program-member-response'

export function makeResponseOfImportProgramMemberResponse(
  overrides: Partial<ResponseOfImportProgramMemberResponse> = {},
): ResponseOfImportProgramMemberResponse {
  return {
    errors: [],
    requestId: mockRequestId(),
    result: faker.helpers.multiple(() => makeImportProgramMemberResponse(), {
      count: { min: 1, max: 3 },
    }),
    success: true,
    warnings: [],
    ...overrides,
  }
}
