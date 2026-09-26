import type { CustomObject } from '../models/custom-object'

export interface LookupCustomObjectRequest {
  /**
   * Maximum number of records to return in the response. Max and default is 300
   */
  batchSize?: number
  /**
   * List of fields to return. If not specified, will return the following fields: marketoGuid, dedupeFields, updatedAt, createdAt, filterType
   */
  fields?: Array<string>
  /**
   * Field to search on. Valid values are: dedupeFields, idFields, and any field defined in searchableFields attribute of Describe endpoint. Default is dedupeFields
   */
  filterType?: string
  /**
   * Search values when using a compound key. Each element must include each of the fields in the compound key. Compound keys are determined by the contents of "dedupeFields" in the Describe result for the object
   */
  input: Array<CustomObject>
  /**
   * Paging token returned from a previous response
   */
  nextPageToken?: string
}
