import { faker } from '@faker-js/faker'
import type { ResponseOfUser } from '../../user-management-definitions/responses/response-of-user'
import { makeUserRoleWorkspace } from './user-role-workspace'

export function makeResponseOfUser(
  overrides: Partial<ResponseOfUser> = {},
): ResponseOfUser {
  return {
    errors: [],
    apiOnly: faker.datatype.boolean(),
    emailAddress: faker.internet.email(),
    expiresAt: faker.lorem.word(),
    lastLoginAt: faker.lorem.word(),
    failedDeviceCode: faker.number.int({ min: 1, max: 1000 }),
    failedLogins: faker.number.int({ min: 1, max: 1000 }),
    firstName: faker.lorem.words({ min: 2, max: 3 }),
    id: faker.number.int({ min: 1, max: 99999 }),
    isLocked: faker.datatype.boolean(),
    lastName: faker.lorem.words({ min: 2, max: 3 }),
    lockedReason: faker.lorem.word(),
    optedIn: faker.datatype.boolean(),
    userRoleWorkspaces: faker.helpers.multiple(() => makeUserRoleWorkspace(), {
      count: { min: 1, max: 3 },
    }),
    userid: faker.lorem.word(),
    ...overrides,
  }
}
