import { faker } from '@faker-js/faker'
import type { ErrorsData } from '../../lead-database-definitions/models/errors-data'

export function makeErrorsData(
  overrides: Partial<ErrorsData> = {},
): ErrorsData {
  return {
    date: faker.date.recent().toISOString(),
    errors: [],
    total: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
