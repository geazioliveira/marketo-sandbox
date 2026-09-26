import { faker } from '@faker-js/faker'
import type { ExportCustomObjectRequest } from '../../lead-database-definitions/requests/export-custom-object-request'
import { makeColumnHeaderNames } from './column-header-names'
import { makeExportCustomObjectFilter } from './export-custom-object-filter'

export function makeExportCustomObjectRequest(
  overrides: Partial<ExportCustomObjectRequest> = {},
): ExportCustomObjectRequest {
  return {
    columnHeaderNames: makeColumnHeaderNames(),
    fields: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    filter: makeExportCustomObjectFilter(),
    format: faker.lorem.word(),
    ...overrides,
  }
}
