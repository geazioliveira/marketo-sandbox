import { faker } from '@faker-js/faker'
import type { ListOperationRequest } from '../../lead-database-definitions/requests/list-operation-request'
import { makeLeadInputData } from './lead-input-data'

export function makeListOperationRequest(
  overrides: Partial<ListOperationRequest> = {},
): ListOperationRequest {
  return {
    input: faker.helpers.multiple(() => makeLeadInputData(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
