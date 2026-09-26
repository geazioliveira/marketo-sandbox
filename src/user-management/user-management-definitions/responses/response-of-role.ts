import type { Error } from '../models/error'

export interface ResponseOfRole {
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors?: Array<Error>
  /**
   * Role description
   */
  description: string
  /**
   * Role id
   */
  id: number
  /**
   * Whether role is hidden
   */
  isHidden: boolean
  /**
   * Whether role is all zones
   */
  isOnlyAllZones: boolean
  /**
   * Role name
   */
  name: string
  /**
   * Role creation time
   */
  createdAt: string
  /**
   * Role update time
   */
  updatedAt: string
  /**
   * Role type
   */
  type: string
}
