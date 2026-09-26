import { faker } from '@faker-js/faker'
import type { ListOperationRequest } from '../../data-ingestion-definitions/requests/list-operation-request'
import { makeLead } from './lead'

export function makeListOperationRequest(
  overrides: Partial<ListOperationRequest> = {},
): ListOperationRequest {
  return {
    listId: faker.number.int({ min: 1, max: 99999 }),
    input: faker.helpers.multiple(() => makeLead(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
