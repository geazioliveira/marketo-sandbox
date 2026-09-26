import { faker } from '@faker-js/faker'
import type { LeadPartition } from '../../lead-database-definitions/models/lead-partition'

export function makeLeadPartition(
  overrides: Partial<LeadPartition> = {},
): LeadPartition {
  return {
    description: faker.lorem.sentence(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
