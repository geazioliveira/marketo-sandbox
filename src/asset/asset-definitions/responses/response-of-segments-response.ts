import type { Error } from '../models/error'
import type { SegmentsResponse } from './segments-response'

export interface ResponseOfSegmentsResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SegmentsResponse>
  success?: boolean
  warnings?: Array<string>
}
