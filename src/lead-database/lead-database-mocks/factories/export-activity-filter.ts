import { faker } from '@faker-js/faker'
import type { ExportActivityFilter } from '../../lead-database-definitions/models/export-activity-filter'
import { makeDateRange } from './date-range'

export function makeExportActivityFilter(
  overrides: Partial<ExportActivityFilter> = {},
): ExportActivityFilter {
  return {
    activityTypeIds: faker.helpers.multiple(
      () => faker.number.int({ min: 1, max: 1000 }),
      { count: { min: 1, max: 3 } },
    ),
    primaryAttributeValueIds: faker.helpers.multiple(
      () => faker.number.int({ min: 1, max: 1000 }),
      { count: { min: 1, max: 3 } },
    ),
    primaryAttributeValues: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    createdAt: makeDateRange(),
    ...overrides,
  }
}
