import { faker } from '@faker-js/faker'
import type { FormResponse } from '../../lead-database-definitions/responses/form-response'
import { makeReason } from './reason'

export function makeFormResponse(
  overrides: Partial<FormResponse> = {},
): FormResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    status: faker.helpers.arrayElement([
      'created',
      'updated',
      'skipped',
    ] as const),
    reasons: faker.helpers.multiple(() => makeReason(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
