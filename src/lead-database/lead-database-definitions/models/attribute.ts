export interface Attribute {
  apiName?: string
  /**
   * Name of the attribute
   */
  name: string
  /**
   * Value of the attribute
   */
  value: Record<string, unknown>
}
