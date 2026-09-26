import { faker } from '@faker-js/faker'
import type { UserRoleWorkspaceId } from '../../user-management-definitions/models/user-role-workspace-id'

export function makeUserRoleWorkspaceId(
  overrides: Partial<UserRoleWorkspaceId> = {},
): UserRoleWorkspaceId {
  return {
    accessRoleId: faker.number.int({ min: 1, max: 99999 }),
    workspaceId: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
