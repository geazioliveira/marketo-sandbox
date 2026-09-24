export interface TagResponseGetAll {
  /**
   * Types of programs to which the tag can apply
   */
  applicableProgramTypes: string
  /**
   * Whether the tag is required for its applicable program types
   */
  required: boolean
  /**
   * Name of the tag
   */
  tagType: string
}
