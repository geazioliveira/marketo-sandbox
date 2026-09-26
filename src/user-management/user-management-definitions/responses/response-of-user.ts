import type { Error } from '../models/error'
import type { UserRoleWorkspace } from '../models/user-role-workspace'

export interface ResponseOfUser {
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
   * Date and time when user login expires.  Example: yyyy-MM-dd'T'HH:mm:ss.SSS't'Z
   */
  expiresAt: string
  /**
   * Date and time of user's most recent login.  Example: yyyy-MM-dd'T'HH:mm:ss.SSS't'Z
   */
  lastLoginAt: string
  /**
   * Device code for user login failure
   */
  failedDeviceCode: number
  /**
   * Count of user login failures
   */
  failedLogins: number
  /**
   * User first name
   */
  firstName: string
  /**
   * User identifier
   */
  id: number
  /**
   * Whether user account is locked
   */
  isLocked: boolean
  /**
   * User last name
   */
  lastName: string
  /**
   * Reason that user account is locked
   */
  lockedReason: string
  /**
   * Whether user has opted in
   */
  optedIn: boolean
  userRoleWorkspaces: Array<UserRoleWorkspace>
  /**
   * Marketo Identity users should use an email address. Adobe Identity users should use the generated GUID.
   */
  userid: string
}
