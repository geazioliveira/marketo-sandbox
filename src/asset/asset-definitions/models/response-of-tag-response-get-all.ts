import type { Error } from './error'
import type { TagResponseGetAll } from './tag-response-get-all'

export interface ResponseOfTagResponseGetAll {
  errors?: Array<Error>
  requestId?: string
  result?: Array<TagResponseGetAll>
  success?: boolean
  warnings?: Array<string>
}
