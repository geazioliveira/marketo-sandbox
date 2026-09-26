import { faker } from '@faker-js/faker'
import type { AddCustomObjectTypeField } from '../../lead-database-definitions/models/add-custom-object-type-field'
import { makeCustomObjectTypeFieldRelatedTo } from './custom-object-type-field-related-to'

export function makeAddCustomObjectTypeField(
  overrides: Partial<AddCustomObjectTypeField> = {},
): AddCustomObjectTypeField {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    dataType: faker.lorem.word(),
    description: faker.lorem.sentence(),
    isDedupeField: faker.datatype.boolean(),
    relatedTo: makeCustomObjectTypeFieldRelatedTo(),
    ...overrides,
  }
}
