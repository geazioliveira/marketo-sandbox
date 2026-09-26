import { faker } from '@faker-js/faker'
import type { ErrorCount } from '../../lead-database-definitions/models/error-count'

export function makeErrorCount(
  overrides: Partial<ErrorCount> = {},
): ErrorCount {
  return {
    count: faker.number.int({ min: 1, max: 1000 }),
    errorCode: faker.lorem.word(),
    ...overrides,
  }
}
