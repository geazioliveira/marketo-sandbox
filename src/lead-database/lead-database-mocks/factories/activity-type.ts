import { faker } from '@faker-js/faker'
import type { ActivityType } from '../../lead-database-definitions/models/activity-type'
import { makeActivityTypeAttribute } from './activity-type-attribute'

export function makeActivityType(
  overrides: Partial<ActivityType> = {},
): ActivityType {
  return {
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    attributes: faker.helpers.multiple(() => makeActivityTypeAttribute(), {
      count: { min: 1, max: 3 },
    }),
    description: faker.lorem.sentence(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    primaryAttribute: makeActivityTypeAttribute(),
    ...overrides,
  }
}
