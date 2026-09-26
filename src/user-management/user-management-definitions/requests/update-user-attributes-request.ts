export interface UpdateUserAttributesRequest {
  /**
   * Whether the user is API-Only.  Default is false
   */
  apiOnly?: boolean
  /**
   * User email address
   */
  emailAddress?: string
  /**
   * Date and time when user login expires.  Example: yyyy-MM-dd'T'HH:mm:ss.SSS't'Z
   */
  expiresAt?: string
  /**
   * User first name
   */
  firstName?: string
  /**
   * User last name
   */
  lastName?: string
}
