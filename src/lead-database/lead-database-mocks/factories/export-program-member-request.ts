import { faker } from '@faker-js/faker'
import type { ExportProgramMemberRequest } from '../../lead-database-definitions/requests/export-program-member-request'
import { makeColumnHeaderNames } from './column-header-names'
import { makeExportProgramMemberFilter } from './export-program-member-filter'

export function makeExportProgramMemberRequest(
  overrides: Partial<ExportProgramMemberRequest> = {},
): ExportProgramMemberRequest {
  return {
    columnHeaderNames: makeColumnHeaderNames(),
    fields: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    filter: makeExportProgramMemberFilter(),
    format: faker.lorem.word(),
    ...overrides,
  }
}
