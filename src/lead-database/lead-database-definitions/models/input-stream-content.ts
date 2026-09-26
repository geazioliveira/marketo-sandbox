import type { InputStream } from './input-stream'

export interface InputStreamContent {
  contentType?: string
  inputStream?: InputStream
}
