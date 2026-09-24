import { faker } from '@faker-js/faker'
import type { UpdateVariableRequest } from '../../asset-definitions/requests/update-variable-request'

export function makeUpdateVariableRequest(
  overrides: Partial<UpdateVariableRequest> = {},
): UpdateVariableRequest {
  return {
    value: faker.lorem.word(),
    moduleId: faker.lorem.word(),
    ...overrides,
  }
}
