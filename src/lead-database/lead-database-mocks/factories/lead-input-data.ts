import { faker } from '@faker-js/faker'
import type { LeadInputData } from '../../lead-database-definitions/models/lead-input-data'

export function makeLeadInputData(
  overrides: Partial<LeadInputData> = {},
): LeadInputData {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
