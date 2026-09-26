import type { DeleteCustomObjectTypeField } from '../models/delete-custom-object-type-field'

export interface DeleteCustomObjectTypeFieldsRequest {
  /**
   * List of fields to delete from the custom object type
   */
  input: Array<DeleteCustomObjectTypeField>
}
