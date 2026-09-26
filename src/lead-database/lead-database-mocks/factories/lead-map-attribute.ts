import { faker } from '@faker-js/faker'
import type { LeadMapAttribute } from '../../lead-database-definitions/models/lead-map-attribute'

export function makeLeadMapAttribute(
  overrides: Partial<LeadMapAttribute> = {},
): LeadMapAttribute {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    readOnly: faker.datatype.boolean(),
    ...overrides,
  }
}
