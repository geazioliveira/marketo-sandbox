import { faker } from '@faker-js/faker'
import type { ExportLeadRequest } from '../../lead-database-definitions/requests/export-lead-request'
import { makeColumnHeaderNames } from './column-header-names'
import { makeExportLeadFilter } from './export-lead-filter'

export function makeExportLeadRequest(
  overrides: Partial<ExportLeadRequest> = {},
): ExportLeadRequest {
  return {
    columnHeaderNames: makeColumnHeaderNames(),
    fields: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    filter: makeExportLeadFilter(),
    format: faker.lorem.word(),
    ...overrides,
  }
}
