import { faker } from '@faker-js/faker'
import type { DeleteLeadRequest } from '../../lead-database-definitions/requests/delete-lead-request'
import { makeLeadInputData } from './lead-input-data'

export function makeDeleteLeadRequest(
  overrides: Partial<DeleteLeadRequest> = {},
): DeleteLeadRequest {
  return {
    input: faker.helpers.multiple(() => makeLeadInputData(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
