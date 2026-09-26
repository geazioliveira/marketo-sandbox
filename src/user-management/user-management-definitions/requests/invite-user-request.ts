import type { UserRoleWorkspaceId } from '../models/user-role-workspace-id'

export interface InviteUserRequest {
  /**
   * Whether the user is API-Only.  Default is false
   */
  apiOnly?: boolean
  /**
   * User email address
   */
  emailAddress: string
  /**
   * Date and time when user login expires.  Must be valid ISO-8601 string.  See <a href="http://developers.marketo.com/rest-api/lead-database/fields/field-types/">Datetime</a> field type description.
   */
  expiresAt?: string
  /**
   * User first name
   */
  firstName: string
  /**
   * User last name
   */
  lastName: string
  /**
   * Marketo Identity users should use an email address. Adobe Identity users should use the generated GUID.
   */
  userid?: string
  /**
   * Reason for user invitation
   */
  reason?: string
  userRoleWorkspaces: Array<UserRoleWorkspaceId>
}
