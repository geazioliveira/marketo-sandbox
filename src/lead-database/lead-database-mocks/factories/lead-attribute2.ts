import { faker } from '@faker-js/faker'
import type { LeadAttribute2 } from '../../lead-database-definitions/models/lead-attribute2'
import { makeLeadAttribute2Fields } from './lead-attribute2-fields'
import { makeLeadAttribute2SearchableFields } from './lead-attribute2-searchable-fields'

export function makeLeadAttribute2(
  overrides: Partial<LeadAttribute2> = {},
): LeadAttribute2 {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    searchableFields: faker.helpers.multiple(
      () => makeLeadAttribute2SearchableFields(),
      { count: { min: 1, max: 3 } },
    ),
    fields: faker.helpers.multiple(() => makeLeadAttribute2Fields(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
