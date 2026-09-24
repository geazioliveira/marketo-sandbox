export interface AutoSuggestValue {
  /**
   * Id of the suggested value
   */
  id: number
  /**
   * Display name of the suggested value
   */
  displayName?: string
  /**
   * Name of the suggested value
   */
  name?: string
  /**
   * Name of the workspace containing the value
   */
  workspace?: string
  /**
   * Id of the workspace containing the value
   */
  workspaceId?: number
}
