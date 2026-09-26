import type { ColumnHeaderNames } from '../models/column-header-names'
import type { ExportProgramMemberFilter } from '../models/export-program-member-filter'

export interface ExportProgramMemberRequest {
  /**
   * File header field names override (corresponds with REST API name)
   */
  columnHeaderNames?: ColumnHeaderNames
  /**
   * Comma-separated list of fields to include in the file
   */
  fields: Array<string>
  /**
   * Program member record selection criteria. Must be the following: "programId"
   */
  filter: ExportProgramMemberFilter
  /**
   * File format to create("CSV", "TSV", "SSV"). Default is "CSV"
   */
  format?: string
}
