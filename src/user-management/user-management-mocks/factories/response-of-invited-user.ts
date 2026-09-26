import { faker } from '@faker-js/faker'
import type { ResponseOfInvitedUser } from '../../user-management-definitions/responses/response-of-invited-user'

export function makeResponseOfInvitedUser(
  overrides: Partial<ResponseOfInvitedUser> = {},
): ResponseOfInvitedUser {
  return {
    errors: [],
    id: faker.number.int({ min: 1, max: 99999 }),
    firstName: faker.lorem.words({ min: 2, max: 3 }),
    lastName: faker.lorem.words({ min: 2, max: 3 }),
    emailAddress: faker.internet.email(),
    userid: faker.lorem.word(),
    subscriptionId: faker.lorem.word(),
    status: faker.helpers.arrayElement(['pending'] as const),
    expiresAt: faker.lorem.word(),
    createdAt: faker.date.recent().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
