import { faker } from '@faker-js/faker'
import type { CustomActivity } from '../../lead-database-definitions/models/custom-activity'
import { makeAttribute } from './attribute'

export function makeCustomActivity(
  overrides: Partial<CustomActivity> = {},
): CustomActivity {
  return {
    activityDate: faker.date.recent().toISOString(),
    activityTypeId: faker.number.int({ min: 1, max: 99999 }),
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    attributes: faker.helpers.multiple(() => makeAttribute(), {
      count: { min: 1, max: 3 },
    }),
    errors: [],
    id: faker.number.int({ min: 1, max: 99999 }),
    leadId: faker.number.int({ min: 1, max: 99999 }),
    marketoGUID: faker.lorem.word(),
    primaryAttributeValue: faker.lorem.word(),
    status: faker.helpers.arrayElement([
      'created',
      'updated',
      'deleted',
      'skipped',
      'added',
      'removed',
    ] as const),
    ...overrides,
  }
}
