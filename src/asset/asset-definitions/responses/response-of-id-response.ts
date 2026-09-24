import type { Error } from '../models/error'
import type { IdResponse } from './id-response'

export interface ResponseOfIdResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<IdResponse>
  success?: boolean
  warnings?: Array<string>
}
