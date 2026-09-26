import type { Attribute } from './attribute'
import type { Error } from './error'

export type CustomActivityStatus =
  'created' | 'updated' | 'deleted' | 'skipped' | 'added' | 'removed'

export interface CustomActivity {
  /**
   * Datetime of the activity
   */
  activityDate: string
  /**
   * Id of the activity type
   */
  activityTypeId: number
  apiName?: string
  /**
   * List of secondary attributes
   */
  attributes: Array<Attribute>
  /**
   * Array of errors that occurred if the request was unsuccessful
   */
  errors: Array<Error>
  /**
   * Integer id of the activity. For instances which have been migrated to Activity Service, this field may not be present, and should not be treated as unique.
   */
  id: number
  /**
   * Id of the lead associated to the activity
   */
  leadId: number
  /**
   * Unique id of the activity (128 character string)
   */
  marketoGUID?: string
  /**
   * Value of the primary attribute
   */
  primaryAttributeValue: string
  /**
   * Status of the operation performed on the record
   */
  status?: CustomActivityStatus
}
