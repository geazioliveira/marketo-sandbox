import type { UserRoleWorkspaceId } from '../models/user-role-workspace-id'

export interface DeleteRolesRequest {
  /**
   * List of roles to delete
   */
  input: Array<UserRoleWorkspaceId>
}
