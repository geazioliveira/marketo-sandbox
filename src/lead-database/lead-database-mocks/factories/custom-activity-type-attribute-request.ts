import { faker } from '@faker-js/faker'
import type { CustomActivityTypeAttributeRequest } from '../../lead-database-definitions/requests/custom-activity-type-attribute-request'
import { makeCustomActivityTypeAttribute } from './custom-activity-type-attribute'

export function makeCustomActivityTypeAttributeRequest(
  overrides: Partial<CustomActivityTypeAttributeRequest> = {},
): CustomActivityTypeAttributeRequest {
  return {
    attributes: faker.helpers.multiple(
      () => makeCustomActivityTypeAttribute(),
      { count: { min: 1, max: 3 } },
    ),
    ...overrides,
  }
}
