import { faker } from '@faker-js/faker'
import type { UpdateLeadPartitionRequest } from '../../lead-database-definitions/requests/update-lead-partition-request'
import { makeUpdateLeadPartition } from './update-lead-partition'

export function makeUpdateLeadPartitionRequest(
  overrides: Partial<UpdateLeadPartitionRequest> = {},
): UpdateLeadPartitionRequest {
  return {
    input: faker.helpers.multiple(() => makeUpdateLeadPartition(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
