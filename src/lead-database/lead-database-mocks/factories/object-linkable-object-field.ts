import { faker } from '@faker-js/faker'
import type { ObjectLinkableObjectField } from '../../lead-database-definitions/models/object-linkable-object-field'

export function makeObjectLinkableObjectField(
  overrides: Partial<ObjectLinkableObjectField> = {},
): ObjectLinkableObjectField {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    dataType: faker.lorem.word(),
    ...overrides,
  }
}
