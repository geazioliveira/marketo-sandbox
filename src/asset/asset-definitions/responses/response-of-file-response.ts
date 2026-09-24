import type { Error } from '../models/error'
import type { FileResponse } from './file-response'

export interface ResponseOfFileResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<FileResponse>
  success?: boolean
  warnings?: Array<string>
}
