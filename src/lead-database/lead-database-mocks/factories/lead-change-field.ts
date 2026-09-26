import { faker } from '@faker-js/faker'
import type { LeadChangeField } from '../../lead-database-definitions/models/lead-change-field'

export function makeLeadChangeField(
  overrides: Partial<LeadChangeField> = {},
): LeadChangeField {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    newValue: faker.lorem.word(),
    oldValue: faker.lorem.word(),
    ...overrides,
  }
}
