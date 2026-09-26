import { faker } from '@faker-js/faker'
import type { ImportProgramMemberResponse } from '../../lead-database-definitions/responses/import-program-member-response'

export function makeImportProgramMemberResponse(
  overrides: Partial<ImportProgramMemberResponse> = {},
): ImportProgramMemberResponse {
  return {
    batchId: faker.number.int({ min: 1, max: 99999 }),
    importId: faker.lorem.word(),
    status: faker.lorem.word(),
    ...overrides,
  }
}
