import { faker } from '@faker-js/faker'
import type { CreateLeadFieldRequest } from '../../lead-database-definitions/requests/create-lead-field-request'
import { makeCreateLeadField } from './create-lead-field'

export function makeCreateLeadFieldRequest(
  overrides: Partial<CreateLeadFieldRequest> = {},
): CreateLeadFieldRequest {
  return {
    input: faker.helpers.multiple(() => makeCreateLeadField(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
