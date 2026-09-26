import { faker } from '@faker-js/faker'
import type { AddCustomObjectTypeFieldsRequest } from '../../lead-database-definitions/requests/add-custom-object-type-fields-request'
import { makeAddCustomObjectTypeField } from './add-custom-object-type-field'

export function makeAddCustomObjectTypeFieldsRequest(
  overrides: Partial<AddCustomObjectTypeFieldsRequest> = {},
): AddCustomObjectTypeFieldsRequest {
  return {
    input: faker.helpers.multiple(() => makeAddCustomObjectTypeField(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
