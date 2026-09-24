import type { Error } from '../models/error'
import type { TokenResponse } from './token-response'

export interface ResponseOfTokenResponse {
  errors?: Array<Error>
  requestId?: string
  result?: Array<TokenResponse>
  success?: boolean
  warnings?: Array<string>
}
