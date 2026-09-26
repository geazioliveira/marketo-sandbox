import { faker } from '@faker-js/faker'
import type { UpdateLeadFieldRequest } from '../../lead-database-definitions/requests/update-lead-field-request'
import { makeUpdateLeadField } from './update-lead-field'

export function makeUpdateLeadFieldRequest(
  overrides: Partial<UpdateLeadFieldRequest> = {},
): UpdateLeadFieldRequest {
  return {
    input: faker.helpers.multiple(() => makeUpdateLeadField(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
