import { faker } from '@faker-js/faker'
import type { ExportLeadFilter } from '../../lead-database-definitions/models/export-lead-filter'
import { makeDateRange } from './date-range'

export function makeExportLeadFilter(
  overrides: Partial<ExportLeadFilter> = {},
): ExportLeadFilter {
  return {
    createdAt: makeDateRange(),
    smartListId: faker.number.int({ min: 1, max: 99999 }),
    smartListName: faker.lorem.words({ min: 2, max: 3 }),
    staticListId: faker.number.int({ min: 1, max: 99999 }),
    staticListName: faker.lorem.words({ min: 2, max: 3 }),
    updatedAt: makeDateRange(),
    ...overrides,
  }
}
