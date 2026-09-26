export interface ExportResponse {
  /**
   * Date when the export request was created
   */
  createdAt?: string
  /**
   * Error message in case of "Failed" status
   */
  errorMsg?: string
  /**
   * Unique id of the export job
   */
  exportId: string
  /**
   * Size of exported file in bytes. This will have a value only when status is "Completed", otherwise null
   */
  fileSize?: number
  /**
   * SHA-256 hash of exported file. This will have a value only when status is "Completed", otherwise null
   */
  fileChecksum?: string
  /**
   * Finish time of export job. This will have value only when status is "Completed" or "Failed", otherwise null
   */
  finishedAt?: string
  /**
   * Format of file as given in the request ("CSV", "TSV", "SSV")
   */
  format?: string
  /**
   * Number of records in the export file. This will have value only when status is "Completed", otherwise null
   */
  numberOfRecords?: number
  /**
   * Queue time of export job. This will have value when "Queued" status is reached, before that null
   */
  queuedAt?: string
  /**
   * Start time of export job. This will have value when "Processing" status is reached, before that null
   */
  startedAt?: string
  /**
   * Status of the export job ("Created","Queued","Processing","Canceled","Completed","Failed")
   */
  status: string
}
