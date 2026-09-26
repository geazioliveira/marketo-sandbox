import { faker } from '@faker-js/faker'
import type { ObjectField } from '../../lead-database-definitions/models/object-field'

export function makeObjectField(
  overrides: Partial<ObjectField> = {},
): ObjectField {
  return {
    dataType: faker.lorem.word(),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    length: faker.number.int({ min: 1, max: 1000 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    updateable: faker.datatype.boolean(),
    crmManaged: faker.datatype.boolean(),
    ...overrides,
  }
}
