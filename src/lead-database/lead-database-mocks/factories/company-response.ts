import { faker } from '@faker-js/faker'
import type { CompanyResponse } from '../../lead-database-definitions/responses/company-response'
import { makeReason } from './reason'

export function makeCompanyResponse(
  overrides: Partial<CompanyResponse> = {},
): CompanyResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    reasons: faker.helpers.multiple(() => makeReason(), {
      count: { min: 1, max: 3 },
    }),
    seq: faker.number.int({ min: 1, max: 1000 }),
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
