import type { EmailTemplateFilterResult } from '../models/email-template-filter-result'

export interface EmailTemplateFilterResponse {
  success?: boolean
  requestId?: string
  result?: EmailTemplateFilterResult
}
