export interface UpdateVariableRequest {
  /**
   * Value to update variable with
   */
  value?: string;
  /**
   * Module that variable is associated with. Required for updating module variables. Not needed for global variables.
   */
  moduleId?: string;
}
