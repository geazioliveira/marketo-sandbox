import { faker } from '@faker-js/faker'
import type { StaticList } from '../../lead-database-definitions/models/static-list'

export function makeStaticList(
  overrides: Partial<StaticList> = {},
): StaticList {
  return {
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    programName: faker.lorem.words({ min: 2, max: 3 }),
    updatedAt: faker.date.recent().toISOString(),
    workspaceName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
