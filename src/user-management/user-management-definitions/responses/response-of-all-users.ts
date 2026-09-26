import type { Error } from '../models/error'
import type { UserRoleWorkspace } from '../models/user-role-workspace'

export interface ResponseOfAllUsers {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors?: Array<Error>
  /**
   * Whether the user is API-Only
   */
  apiOnly: boolean
  /**
   * User email address
   */
  emailAddress: string
  /**
   * User first name
   */
  firstName: string
  /**
   * User identifier
   */
  id: number
  /**
   * User last name
   */
  lastName: string
  /**
   * Marketo Identity users should use an email address. Adobe Identity users should use the generated GUID.
   */
  userid: string
  /**
   * Role and workspace assignments for the user.  Only included when includeRoleWorkspace is true.  Requires the Access Roles permission
   */
  userRoleWorkspaces?: Array<UserRoleWorkspace>
}
