import { faker } from '@faker-js/faker'
import type { InviteUserRequest } from '../../user-management-definitions/requests/invite-user-request'
import { makeUserRoleWorkspaceId } from './user-role-workspace-id'

export function makeInviteUserRequest(
  overrides: Partial<InviteUserRequest> = {},
): InviteUserRequest {
  return {
    apiOnly: faker.datatype.boolean(),
    emailAddress: faker.internet.email(),
    expiresAt: faker.lorem.word(),
    firstName: faker.lorem.words({ min: 2, max: 3 }),
    lastName: faker.lorem.words({ min: 2, max: 3 }),
    userid: faker.lorem.word(),
    reason: faker.lorem.word(),
    userRoleWorkspaces: faker.helpers.multiple(
      () => makeUserRoleWorkspaceId(),
      { count: { min: 1, max: 3 } },
    ),
    ...overrides,
  }
}
