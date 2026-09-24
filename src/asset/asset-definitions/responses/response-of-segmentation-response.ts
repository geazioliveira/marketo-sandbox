import type { Error } from '../models/error'
import type { SegmentationResponse } from './segmentation-response'

export interface ResponseOfSegmentationResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SegmentationResponse>
  success?: boolean
  warnings?: Array<string>
}
