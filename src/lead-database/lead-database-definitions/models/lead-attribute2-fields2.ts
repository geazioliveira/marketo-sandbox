export interface LeadAttribute2Fields2 {
  /**
   * REST API name of field
   */
  name: string
  /**
   * Display name of field (friendly name)
   */
  displayName: string
  /**
   * Data type of field
   */
  dataType: string
  /**
   * Length of field
   */
  length?: number
  /**
   * Is field updateable
   */
  updateable: boolean
  /**
   * Is field managed by CRM
   */
  crmManaged: boolean
}
