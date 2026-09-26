import { faker } from '@faker-js/faker'
import type { ExportCustomObjectFilter } from '../../lead-database-definitions/models/export-custom-object-filter'
import { makeDateRange } from './date-range'

export function makeExportCustomObjectFilter(
  overrides: Partial<ExportCustomObjectFilter> = {},
): ExportCustomObjectFilter {
  return {
    updatedAt: makeDateRange(),
    smartListId: faker.number.int({ min: 1, max: 99999 }),
    smartListName: faker.lorem.words({ min: 2, max: 3 }),
    staticListId: faker.number.int({ min: 1, max: 99999 }),
    staticListName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
