import type { CustomActivityTypeAttribute } from '../models/custom-activity-type-attribute'

export interface CustomActivityTypeAttributeRequest {
  /**
   * List of attributes to add to the activity type
   */
  attributes?: Array<CustomActivityTypeAttribute>
}
