import { faker } from '@faker-js/faker'
import type { ResponseOfIdentity } from '../../identity-definitions/responses/response-of-identity'

export function makeResponseOfIdentity(
  overrides: Partial<ResponseOfIdentity> = {},
): ResponseOfIdentity {
  return {
    access_token: faker.lorem.word(),
    scope: faker.lorem.word(),
    expires_in: faker.number.int({ min: 1, max: 1000 }),
    token_type: faker.helpers.arrayElement(['bearer'] as const),
    ...overrides,
  }
}
