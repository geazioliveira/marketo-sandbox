import { faker } from '@faker-js/faker'
import type { IdentityRequest } from '../../identity-definitions/requests/identity-request'

export function makeIdentityRequest(
  overrides: Partial<IdentityRequest> = {},
): IdentityRequest {
  return {
    client_id: faker.lorem.word(),
    client_secret: faker.lorem.word(),
    grant_type: faker.helpers.arrayElement(['client_credentials'] as const),
    ...overrides,
  }
}
