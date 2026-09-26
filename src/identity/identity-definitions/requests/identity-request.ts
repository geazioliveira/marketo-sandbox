export type IdentityRequestGrantType = 'client_credentials'

export interface IdentityRequest {
  /**
   * Client ID from Admin > Integration > Launchpoint menu
   */
  client_id: string
  /**
   * Client Secret from Admin > Integration > Launchpoint menu
   */
  client_secret: string
  /**
   * Grant type
   */
  grant_type: IdentityRequestGrantType
}
