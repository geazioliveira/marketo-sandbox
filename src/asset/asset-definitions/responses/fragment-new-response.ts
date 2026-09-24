import type { FragmentDetailDTO } from '../models/fragment-detail-dto'

export interface FragmentNewResponse {
  success?: boolean
  requestId?: string
  result?: Array<FragmentDetailDTO>
}
