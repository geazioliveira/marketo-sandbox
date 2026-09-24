import type { DataDTO } from '../models/data-dto'
import type { EditorContextDto } from '../models/editor-context-dto'
import type { EmailAppDataDTO } from '../models/email-app-data-dto'
import type { EmailHeadersDTO } from '../models/email-headers-dto'
import type { EmailSettingsDTO } from '../models/email-settings-dto'

export interface CreateEmailV2Request {
  name: string
  description?: string
  appData: EmailAppDataDTO
  data?: DataDTO
  headers: EmailHeadersDTO
  editorContext?: EditorContextDto
  settings?: EmailSettingsDTO
  /**
   * When provided, the template's content overwrites any data sent in the request.
   */
  templateId?: string
}
