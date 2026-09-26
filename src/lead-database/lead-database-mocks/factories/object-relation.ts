import { faker } from '@faker-js/faker'
import type { ObjectRelation } from '../../lead-database-definitions/models/object-relation'
import { makeRelatedObject } from './related-object'

export function makeObjectRelation(
  overrides: Partial<ObjectRelation> = {},
): ObjectRelation {
  return {
    field: faker.lorem.word(),
    relatedTo: makeRelatedObject(),
    type: faker.lorem.word(),
    ...overrides,
  }
}
