import { faker } from '@faker-js/faker'
import type { ResponseOfAllUsers } from '../../user-management-definitions/responses/response-of-all-users'
import { makeUserRoleWorkspace } from './user-role-workspace'

export function makeResponseOfAllUsers(
  overrides: Partial<ResponseOfAllUsers> = {},
): ResponseOfAllUsers {
  return {
    errors: [],
    apiOnly: faker.datatype.boolean(),
    emailAddress: faker.internet.email(),
    firstName: faker.lorem.words({ min: 2, max: 3 }),
    id: faker.number.int({ min: 1, max: 99999 }),
    lastName: faker.lorem.words({ min: 2, max: 3 }),
    userid: faker.lorem.word(),
    userRoleWorkspaces: faker.helpers.multiple(() => makeUserRoleWorkspace(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
