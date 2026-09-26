import { faker } from '@faker-js/faker'
import type { UsageData } from '../../lead-database-definitions/models/usage-data'
import { makeUserCount } from './user-count'

export function makeUsageData(overrides: Partial<UsageData> = {}): UsageData {
  return {
    date: faker.date.recent().toISOString(),
    total: faker.number.int({ min: 1, max: 1000 }),
    users: faker.helpers.multiple(() => makeUserCount(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
