import { faker } from '@faker-js/faker'
import type { UserRoleWorkspace } from '../../user-management-definitions/models/user-role-workspace'

export function makeUserRoleWorkspace(
  overrides: Partial<UserRoleWorkspace> = {},
): UserRoleWorkspace {
  return {
    accessRoleId: faker.number.int({ min: 1, max: 99999 }),
    accessRoleName: faker.lorem.words({ min: 2, max: 3 }),
    workspaceId: faker.number.int({ min: 1, max: 99999 }),
    workspaceName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
