import { faker } from '@faker-js/faker'
import type { DeleteCustomObjectTypeFieldsRequest } from '../../lead-database-definitions/requests/delete-custom-object-type-fields-request'
import { makeDeleteCustomObjectTypeField } from './delete-custom-object-type-field'

export function makeDeleteCustomObjectTypeFieldsRequest(
  overrides: Partial<DeleteCustomObjectTypeFieldsRequest> = {},
): DeleteCustomObjectTypeFieldsRequest {
  return {
    input: faker.helpers.multiple(() => makeDeleteCustomObjectTypeField(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
