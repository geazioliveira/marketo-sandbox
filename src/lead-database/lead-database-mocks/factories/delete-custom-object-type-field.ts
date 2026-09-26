import { faker } from '@faker-js/faker'
import type { DeleteCustomObjectTypeField } from '../../lead-database-definitions/models/delete-custom-object-type-field'

export function makeDeleteCustomObjectTypeField(
  overrides: Partial<DeleteCustomObjectTypeField> = {},
): DeleteCustomObjectTypeField {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
