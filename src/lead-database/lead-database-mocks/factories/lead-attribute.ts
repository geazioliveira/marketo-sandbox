import { faker } from '@faker-js/faker'
import type { LeadAttribute } from '../../lead-database-definitions/models/lead-attribute'
import { makeLeadMapAttribute } from './lead-map-attribute'

export function makeLeadAttribute(
  overrides: Partial<LeadAttribute> = {},
): LeadAttribute {
  return {
    dataType: faker.lorem.word(),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    id: faker.number.int({ min: 1, max: 99999 }),
    length: faker.number.int({ min: 1, max: 1000 }),
    rest: makeLeadMapAttribute(),
    soap: makeLeadMapAttribute(),
    ...overrides,
  }
}
