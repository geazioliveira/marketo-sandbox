import { faker } from '@faker-js/faker'
import type { ObjectLinkableObject } from '../../lead-database-definitions/models/object-linkable-object'
import { makeObjectLinkableObjectField } from './object-linkable-object-field'

export function makeObjectLinkableObject(
  overrides: Partial<ObjectLinkableObject> = {},
): ObjectLinkableObject {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    fields: faker.helpers.multiple(() => makeObjectLinkableObjectField(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
