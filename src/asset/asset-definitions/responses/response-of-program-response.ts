import type { Error } from '../models/error'
import type { ProgramResponse } from './program-response'

export interface ResponseOfProgramResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<ProgramResponse>
  success?: boolean
  warnings?: Array<string>
}
