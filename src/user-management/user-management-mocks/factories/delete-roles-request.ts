import { faker } from '@faker-js/faker'
import type { DeleteRolesRequest } from '../../user-management-definitions/requests/delete-roles-request'
import { makeUserRoleWorkspaceId } from './user-role-workspace-id'

export function makeDeleteRolesRequest(
  overrides: Partial<DeleteRolesRequest> = {},
): DeleteRolesRequest {
  return {
    input: faker.helpers.multiple(() => makeUserRoleWorkspaceId(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
