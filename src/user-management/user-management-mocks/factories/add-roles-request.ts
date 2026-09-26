import { faker } from '@faker-js/faker'
import type { AddRolesRequest } from '../../user-management-definitions/requests/add-roles-request'
import { makeUserRoleWorkspaceId } from './user-role-workspace-id'

export function makeAddRolesRequest(
  overrides: Partial<AddRolesRequest> = {},
): AddRolesRequest {
  return {
    input: faker.helpers.multiple(() => makeUserRoleWorkspaceId(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
