import type { Error } from '../models/error'

export type ResponseOfInvitedUserStatus = 'pending'

export interface ResponseOfInvitedUser {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors?: Array<Error>
  /**
   * User identifier
   */
  id: number
  /**
   * User first name
   */
  firstName: string
  /**
   * User last name
   */
  lastName: string
  /**
   * User email address
   */
  emailAddress: string
  /**
   * Marketo Identity users should use an email address. Adobe Identity users should use the generated GUID.
   */
  userid: string
  /**
   * Subscription ID
   */
  subscriptionId: string
  /**
   * User status
   */
  status: ResponseOfInvitedUserStatus
  /**
   * Date and time when user login expires.  Example: yyyy-MM-dd'T'HH:mm:ss.SSS't'Z
   */
  expiresAt: string
  /**
   * Date and time when user login was created.  Example: yyyy-MM-dd'T'HH:mm:ss.SSS't'Z
   */
  createdAt: string
  /**
   * Date and time when user login was last updated.  Example: yyyy-MM-dd'T'HH:mm:ss.SSS't'Z
   */
  updatedAt: string
}
