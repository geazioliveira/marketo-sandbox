import { faker } from '@faker-js/faker'
import type { AddFormFieldSetRequest } from '../../asset-definitions/requests/add-form-field-set-request'

export function makeAddFormFieldSetRequest(
  overrides: Partial<AddFormFieldSetRequest> = {},
): AddFormFieldSetRequest {
  return {
    label: faker.lorem.words({ min: 2, max: 5 }),
    ...overrides,
  }
}
