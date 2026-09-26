import { faker } from '@faker-js/faker'
import type { CustomActivityTypeRequest } from '../../lead-database-definitions/requests/custom-activity-type-request'
import { makeCustomActivityTypeAttribute } from './custom-activity-type-attribute'

export function makeCustomActivityTypeRequest(
  overrides: Partial<CustomActivityTypeRequest> = {},
): CustomActivityTypeRequest {
  return {
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    filterName: faker.lorem.words({ min: 2, max: 3 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    primaryAttribute: makeCustomActivityTypeAttribute(),
    triggerName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
