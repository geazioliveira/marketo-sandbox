import type { Error } from '../models/error'
import type { FieldsMetaDataResponse } from './fields-meta-data-response'

export interface ResponseOfFieldsMetaDataResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<FieldsMetaDataResponse>
  success?: boolean
  warnings?: Array<string>
}
