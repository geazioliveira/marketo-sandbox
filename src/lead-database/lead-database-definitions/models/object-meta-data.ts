import type { ObjectField } from './object-field'
import type { ObjectRelation } from './object-relation'

export type ObjectMetaDataState = 'draft' | 'approved' | 'approvedWithDraft'
export type ObjectMetaDataVersion = 'draft' | 'approved'

export interface ObjectMetaData {
  /**
   * Datetime when the object type was created
   */
  createdAt: string
  /**
   * List of dedupe fields. Arrays with multiple members are compound keys
   */
  dedupeFields: Array<string>
  /**
   * Description of the object type
   */
  description: string
  /**
   * UI display-name of the object type
   */
  displayName: string
  /**
   * UI plural-name of the custom object type
   */
  pluralName: string
  /**
   * List of fields available on the object type
   */
  fields: Array<ObjectField>
  /**
   * Primary id key of the object type
   */
  idField: string
  /**
   * Name of the object type
   */
  apiName: string
  /**
   * List of relationships which the object has
   */
  relationships: Array<ObjectRelation>
  /**
   * List of fields valid for use as a filter type in a query
   */
  searchableFields: Array<Array<string>>
  /**
   * Datetime when the object type was most recently updated
   */
  updatedAt: string
  /**
   * Approval state of object type
   */
  state?: ObjectMetaDataState
  /**
   * Version of object type that is returned in response
   */
  version: ObjectMetaDataVersion
}
