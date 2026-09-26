export interface StaticList {
  /**
   * Datetime when the list was created
   */
  createdAt: string
  /**
   * Description of the static list
   */
  description?: string
  /**
   * Unique integer id of the static list
   */
  id: number
  /**
   * Name of the static list
   */
  name: string
  /**
   * Name of the program
   */
  programName?: string
  /**
   * Datetime when the list was most recently updated
   */
  updatedAt: string
  /**
   * Name of the parent workspace, if applicable
   */
  workspaceName?: string
}
