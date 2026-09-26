import { faker } from '@faker-js/faker'
import type { CustomActivityTypeAttribute } from '../../lead-database-definitions/models/custom-activity-type-attribute'

export function makeCustomActivityTypeAttribute(
  overrides: Partial<CustomActivityTypeAttribute> = {},
): CustomActivityTypeAttribute {
  return {
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    dataType: faker.helpers.arrayElement([
      'string',
      'boolean',
      'integer',
      'float',
      'link',
      'email',
      'currency',
      'date',
      'datetime',
      'phone',
      'text',
    ] as const),
    description: faker.lorem.sentence(),
    isPrimary: faker.datatype.boolean(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
