import { faker } from '@faker-js/faker'
import type { UpdateUserAttributesRequest } from '../../user-management-definitions/requests/update-user-attributes-request'

export function makeUpdateUserAttributesRequest(
  overrides: Partial<UpdateUserAttributesRequest> = {},
): UpdateUserAttributesRequest {
  return {
    apiOnly: faker.datatype.boolean(),
    emailAddress: faker.internet.email(),
    expiresAt: faker.lorem.word(),
    firstName: faker.lorem.words({ min: 2, max: 3 }),
    lastName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
