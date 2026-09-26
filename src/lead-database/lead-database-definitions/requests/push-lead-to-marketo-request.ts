import type { PushLead } from '../models/push-lead'

export interface PushLeadToMarketoRequest {
  input?: Array<PushLead>
  lookupField?: string
  partitionName?: string
  programName?: string
  programStatus?: string
  reason?: string
  source?: string
}
