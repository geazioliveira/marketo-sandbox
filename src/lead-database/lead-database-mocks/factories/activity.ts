import { faker } from '@faker-js/faker'
import type { Activity } from '../../lead-database-definitions/models/activity'
import { makeAttribute } from './attribute'

export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    activityDate: faker.date.recent().toISOString(),
    activityTypeId: faker.number.int({ min: 1, max: 99999 }),
    attributes: faker.helpers.multiple(() => makeAttribute(), {
      count: { min: 1, max: 3 },
    }),
    campaignId: faker.number.int({ min: 1, max: 99999 }),
    id: faker.number.int({ min: 1, max: 99999 }),
    leadId: faker.number.int({ min: 1, max: 99999 }),
    marketoGUID: faker.lorem.word(),
    primaryAttributeValue: faker.lorem.word(),
    primaryAttributeValueId: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
