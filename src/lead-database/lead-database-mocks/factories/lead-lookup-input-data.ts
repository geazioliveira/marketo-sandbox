import { faker } from '@faker-js/faker'
import type { LeadLookupInputData } from '../../lead-database-definitions/models/lead-lookup-input-data'

export function makeLeadLookupInputData(
  overrides: Partial<LeadLookupInputData> = {},
): LeadLookupInputData {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
