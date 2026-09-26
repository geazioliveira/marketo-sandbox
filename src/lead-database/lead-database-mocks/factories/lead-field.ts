import { faker } from '@faker-js/faker'
import type { LeadField } from '../../lead-database-definitions/models/lead-field'

export function makeLeadField(overrides: Partial<LeadField> = {}): LeadField {
  return {
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    dataType: faker.lorem.word(),
    length: faker.number.int({ min: 1, max: 1000 }),
    isHidden: faker.datatype.boolean(),
    isHtmlEncodingInEmail: faker.datatype.boolean(),
    isSensitive: faker.datatype.boolean(),
    isCustom: faker.datatype.boolean(),
    isApiCreated: faker.datatype.boolean(),
    ...overrides,
  }
}
