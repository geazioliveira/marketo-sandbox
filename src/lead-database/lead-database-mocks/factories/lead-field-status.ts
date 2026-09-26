import { faker } from '@faker-js/faker'
import type { LeadFieldStatus } from '../../lead-database-definitions/models/lead-field-status'

export function makeLeadFieldStatus(
  overrides: Partial<LeadFieldStatus> = {},
): LeadFieldStatus {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    status: faker.helpers.arrayElement(['created', 'updated'] as const),
    ...overrides,
  }
}
