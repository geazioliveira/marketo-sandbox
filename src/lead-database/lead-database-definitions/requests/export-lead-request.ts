import type { ColumnHeaderNames } from '../models/column-header-names'
import type { ExportLeadFilter } from '../models/export-lead-filter'

export interface ExportLeadRequest {
  /**
   * File header field names override (corresponds with REST API name)
   */
  columnHeaderNames?: ColumnHeaderNames
  /**
   * Comma-separated list of fields to include in the file
   */
  fields: Array<string>
  /**
   * Lead record selection criteria. Can be one of the following: "createdAt", "updatedAt", "staticListName", "staticListId", "smartListName", "smartListId"
   */
  filter: ExportLeadFilter
  /**
   * File format to create("CSV", "TSV", "SSV"). Default is "CSV"
   */
  format?: string
}
