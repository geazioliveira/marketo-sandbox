import type { BulkUsedByItemDTO } from '../models/bulk-used-by-item-dto'

export interface BulkUsedByResponse {
  success?: boolean
  requestId?: string
  result?: Array<BulkUsedByItemDTO>
}
