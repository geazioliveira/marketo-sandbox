import { faker } from '@faker-js/faker'
import type { LeadAttribute2Fields } from '../../lead-database-definitions/models/lead-attribute2-fields'

export function makeLeadAttribute2Fields(
  overrides: Partial<LeadAttribute2Fields> = {},
): LeadAttribute2Fields {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    dataType: faker.lorem.word(),
    length: faker.number.int({ min: 1, max: 1000 }),
    updateable: faker.datatype.boolean(),
    crmManaged: faker.datatype.boolean(),
    ...overrides,
  }
}
