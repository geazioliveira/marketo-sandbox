import type { Error } from '../models/error'
import type { TagResponseGetAll } from '../models/tag-response-get-all'

export interface ResponseOfTagResponseGetAll {
  errors?: Array<Error>
  requestId?: string
  result?: Array<TagResponseGetAll>
  success?: boolean
  warnings?: Array<string>
}
