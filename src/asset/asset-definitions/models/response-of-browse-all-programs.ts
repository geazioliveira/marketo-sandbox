import type { BrowseAllPrograms } from './browse-all-programs'
import type { Error } from './error'

export interface ResponseOfBrowseAllPrograms {
  errors?: Array<Error>
  requestId?: string
  result?: Array<BrowseAllPrograms>
  success?: boolean
  warnings?: Array<string>
}
