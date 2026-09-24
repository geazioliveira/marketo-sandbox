import type { Error } from '../models/error'
import type { SnippetResponse } from './snippet-response'

export interface ResponseOfSnippetResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<SnippetResponse>
  success?: boolean
  warnings?: Array<string>
}
