import type { UserRoleWorkspaceId } from '../models/user-role-workspace-id'

export interface AddRolesRequest {
  /**
   * List of roles to add
   */
  input: Array<UserRoleWorkspaceId>
}
