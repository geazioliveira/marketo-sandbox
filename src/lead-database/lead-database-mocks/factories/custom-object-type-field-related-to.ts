import { faker } from '@faker-js/faker'
import type { CustomObjectTypeFieldRelatedTo } from '../../lead-database-definitions/models/custom-object-type-field-related-to'

export function makeCustomObjectTypeFieldRelatedTo(
  overrides: Partial<CustomObjectTypeFieldRelatedTo> = {},
): CustomObjectTypeFieldRelatedTo {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    field: faker.lorem.word(),
    ...overrides,
  }
}
