export type SyncCustomObjectTypeRequestAction =
  'createOnly' | 'updateOnly' | 'createOrUpdate'

export interface SyncCustomObjectTypeRequest {
  /**
   * Type of sync operation to perform. Default is createOrUpdate.
   */
  action?: SyncCustomObjectTypeRequestAction
  /**
   * UI display-name of the custom object type
   */
  displayName: string
  /**
   * API name of the custom object type
   */
  apiName: string
  /**
   * UI plural-name of the custom object type
   */
  pluralName?: string
  /**
   * Description of the custom object type
   */
  description?: string
  /**
   * Whether to show custom object type in lead detail of UI. Default is false
   */
  showInLeadDetail?: boolean
}
