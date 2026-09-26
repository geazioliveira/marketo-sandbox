import type { AddCustomObjectTypeField } from '../models/add-custom-object-type-field'

export interface AddCustomObjectTypeFieldsRequest {
  /**
   * List of fields to add to custom object type
   */
  input: Array<AddCustomObjectTypeField>
}
