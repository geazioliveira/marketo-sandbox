import { faker } from '@faker-js/faker'
import type { CustomActivityRequest } from '../../lead-database-definitions/requests/custom-activity-request'
import { makeCustomActivity } from './custom-activity'

export function makeCustomActivityRequest(
  overrides: Partial<CustomActivityRequest> = {},
): CustomActivityRequest {
  return {
    input: faker.helpers.multiple(() => makeCustomActivity(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
