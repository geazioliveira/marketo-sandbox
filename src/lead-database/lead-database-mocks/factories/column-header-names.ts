import { faker } from '@faker-js/faker'
import type { ColumnHeaderNames } from '../../lead-database-definitions/models/column-header-names'

export function makeColumnHeaderNames(
  overrides: Partial<ColumnHeaderNames> = {},
): ColumnHeaderNames {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    value: faker.lorem.word(),
    ...overrides,
  }
}
