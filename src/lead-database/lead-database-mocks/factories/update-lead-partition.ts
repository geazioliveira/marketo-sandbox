import { faker } from '@faker-js/faker'
import type { UpdateLeadPartition } from '../../lead-database-definitions/models/update-lead-partition'

export function makeUpdateLeadPartition(
  overrides: Partial<UpdateLeadPartition> = {},
): UpdateLeadPartition {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    partitionName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
