import { faker } from '@faker-js/faker'
import type { ActivityTypeAttribute } from '../../lead-database-definitions/models/activity-type-attribute'

export function makeActivityTypeAttribute(
  overrides: Partial<ActivityTypeAttribute> = {},
): ActivityTypeAttribute {
  return {
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    dataType: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
