import { faker } from '@faker-js/faker'
import type { UpdateLeadField } from '../../lead-database-definitions/models/update-lead-field'

export function makeUpdateLeadField(
  overrides: Partial<UpdateLeadField> = {},
): UpdateLeadField {
  return {
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    isHidden: faker.datatype.boolean(),
    isHtmlEncodingInEmail: faker.datatype.boolean(),
    isSensitive: faker.datatype.boolean(),
    ...overrides,
  }
}
