import { faker } from '@faker-js/faker'
import type { UserCount } from '../../lead-database-definitions/models/user-count'

export function makeUserCount(overrides: Partial<UserCount> = {}): UserCount {
  return {
    count: faker.number.int({ min: 1, max: 1000 }),
    userId: faker.lorem.word(),
    ...overrides,
  }
}
