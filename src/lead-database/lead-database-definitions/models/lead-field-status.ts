export type LeadFieldStatusStatus = 'created' | 'updated'

export interface LeadFieldStatus {
  /**
   * API name of the field
   */
  name: string
  /**
   * Status of the operation performed on the record
   */
  status: LeadFieldStatusStatus
}
