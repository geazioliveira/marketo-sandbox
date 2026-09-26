import type { RelatedObject } from './related-object'

export interface ObjectRelation {
  /**
   * API Name of link field
   */
  field: string
  /**
   * Object to which the field is linked
   */
  relatedTo: RelatedObject
  /**
   * Type of the relationship field
   */
  type: string
}
