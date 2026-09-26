import type { Error } from '../models/error'

export interface ResponseOfWorkspace {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors?: Array<Error>
  /**
   * Workspace currency information
   */
  currencyInfo: string
  /**
   * Workspace description
   */
  description: string
  /**
   * Workspace global visualization
   */
  globalViz: number
  /**
   * Workspace id
   */
  id: number
  /**
   * Workspace name
   */
  name: string
  /**
   * Workspace creation time
   */
  createdAt?: string
  /**
   * Workspace updated time
   */
  updatedAt?: string
  /**
   * Workspace status
   */
  status: string
}
