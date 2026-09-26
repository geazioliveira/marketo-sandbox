import { faker } from '@faker-js/faker'
import type { ListOperationOutputData } from '../../lead-database-definitions/models/list-operation-output-data'
import { makeReason } from './reason'

export function makeListOperationOutputData(
  overrides: Partial<ListOperationOutputData> = {},
): ListOperationOutputData {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    reasons: faker.helpers.multiple(() => makeReason(), {
      count: { min: 1, max: 3 },
    }),
    status: faker.lorem.word(),
    ...overrides,
  }
}
