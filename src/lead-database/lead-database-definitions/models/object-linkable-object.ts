import type { ObjectLinkableObjectField } from './object-linkable-object-field'

export interface ObjectLinkableObject {
  /**
   * Link object API name
   */
  name: string
  /**
   * Link object UI display-name
   */
  displayName: string
  /**
   * List of fields available on the link object
   */
  fields: Array<ObjectLinkableObjectField>
}
