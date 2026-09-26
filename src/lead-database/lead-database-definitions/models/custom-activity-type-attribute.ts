export type CustomActivityTypeAttributeDataType =
  | 'string'
  | 'boolean'
  | 'integer'
  | 'float'
  | 'link'
  | 'email'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'phone'
  | 'text'

export interface CustomActivityTypeAttribute {
  /**
   * API Name of the attribute
   */
  apiName: string
  /**
   * Data type of the attribute
   */
  dataType?: CustomActivityTypeAttributeDataType
  /**
   * Description of the attribute
   */
  description?: string
  /**
   * Whether the attribute is the primary attribute of the activity type. There may only be one primary attribute at a time
   */
  isPrimary?: boolean
  /**
   * Human-readable display name of the attribute
   */
  name: string
}
