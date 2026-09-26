import type { CustomActivity } from '../models/custom-activity'

export interface CustomActivityRequest {
  /**
   * List of custom activities to insert
   */
  input: Array<CustomActivity>
}
