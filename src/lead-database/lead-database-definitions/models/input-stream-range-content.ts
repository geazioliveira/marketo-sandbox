import type { FileRange } from './file-range'
import type { InputStream } from './input-stream'

export interface InputStreamRangeContent {
  contentType?: string
  fileRange?: FileRange
  inputStream?: InputStream
  length?: number
}
