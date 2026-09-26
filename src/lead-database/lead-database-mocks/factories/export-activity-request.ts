import { faker } from '@faker-js/faker'
import type { ExportActivityRequest } from '../../lead-database-definitions/requests/export-activity-request'
import { makeColumnHeaderNames } from './column-header-names'
import { makeExportActivityFilter } from './export-activity-filter'

export function makeExportActivityRequest(
  overrides: Partial<ExportActivityRequest> = {},
): ExportActivityRequest {
  return {
    columnHeaderNames: makeColumnHeaderNames(),
    fields: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    filter: makeExportActivityFilter(),
    format: faker.lorem.word(),
    ...overrides,
  }
}
