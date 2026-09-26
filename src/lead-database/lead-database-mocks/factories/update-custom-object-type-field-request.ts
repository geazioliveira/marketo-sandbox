import { faker } from '@faker-js/faker'
import type { UpdateCustomObjectTypeFieldRequest } from '../../lead-database-definitions/requests/update-custom-object-type-field-request'
import { makeCustomObjectTypeFieldRelatedTo } from './custom-object-type-field-related-to'

export function makeUpdateCustomObjectTypeFieldRequest(
  overrides: Partial<UpdateCustomObjectTypeFieldRequest> = {},
): UpdateCustomObjectTypeFieldRequest {
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
