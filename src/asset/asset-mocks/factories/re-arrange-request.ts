import { faker } from '@faker-js/faker'
import type { ReArrangeRequest } from '../../asset-definitions/requests/re-arrange-request'
import { makeUpdateFieldPosition } from './update-field-position'

export function makeReArrangeRequest(
  overrides: Partial<ReArrangeRequest> = {},
): ReArrangeRequest {
  return {
    positions: faker.helpers.multiple(() => makeUpdateFieldPosition(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
