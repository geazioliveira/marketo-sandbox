import type { ColumnHeaderNames } from '../models/column-header-names'
import type { ExportActivityFilter } from '../models/export-activity-filter'

export interface ExportActivityRequest {
  /**
   * File header field names override (corresponds with REST API name)
   */
  columnHeaderNames?: ColumnHeaderNames
  /**
   * Array of strings containing field values. Used to reduce the number of fields contained in export file. Select one or more of: marketoGUID, leadId, activityDate, activityTypeId, campaignId, primaryAttributeValueId, primaryAttributeValue, actionResult
   */
  fields: Array<string>
  /**
   * Record selection criteria. "createdAt" is required, "activityTypeIds", "primaryAttributeValueIds", and "primaryAttributeValues" are optional
   */
  filter: ExportActivityFilter
  /**
   * File format to create("CSV", "TSV", "SSV"). Default is "CSV"
   */
  format?: string
}
