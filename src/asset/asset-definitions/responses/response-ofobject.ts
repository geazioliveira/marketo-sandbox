import type { Error } from '../models/error'

export interface ResponseOfobject {
  errors?: Array<Error>
  requestId?: string
  result?: Array<Record<string, unknown>>
  success?: boolean
  warnings?: Array<string>
}
