import type { DataDTO } from '../models/data-dto'
import type { EditorContextDto } from '../models/editor-context-dto'

export interface UpdateEmailTemplateRequest {
  name?: string
  description?: string
  data?: DataDTO
  editorContext?: EditorContextDto
}
