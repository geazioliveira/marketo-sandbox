import { faker } from '@faker-js/faker'
import type { List } from '../../lead-database-definitions/models/list'

export function makeList(overrides: Partial<List> = {}): List {
  return {
    createdAt: faker.date.recent().toISOString(),
    listId: faker.number.int({ min: 1, max: 99999 }),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
