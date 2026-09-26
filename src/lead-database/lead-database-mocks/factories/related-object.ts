import { faker } from '@faker-js/faker'
import type { RelatedObject } from '../../lead-database-definitions/models/related-object'

export function makeRelatedObject(
  overrides: Partial<RelatedObject> = {},
): RelatedObject {
  return {
    field: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
