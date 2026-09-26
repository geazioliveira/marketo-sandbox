import type { ActivityTypeAttribute } from './activity-type-attribute'

export interface ActivityType {
  apiName?: string
  /**
   * List of secondary attributes of the type
   */
  attributes: Array<ActivityTypeAttribute>
  /**
   * Description of the activity type
   */
  description?: string
  /**
   * Id of the activity type
   */
  id: number
  /**
   * Name of the activity type
   */
  name: string
  /**
   * Primary attribute of the type
   */
  primaryAttribute: ActivityTypeAttribute
}
