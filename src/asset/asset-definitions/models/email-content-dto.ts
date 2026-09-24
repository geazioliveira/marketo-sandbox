import type { AssociatedStateDTO } from './associated-state-dto'
import type { ContentMetadataDTO } from './content-metadata-dto'
import type { EditorContextDto } from './editor-context-dto'
import type { EmailAppDataResponseDTO } from './email-app-data-response-dto'
import type { EmailHeadersDTO } from './email-headers-dto'
import type { EmailSettingsResponseDTO } from './email-settings-response-dto'

export interface EmailContentDTO {
  id?: string
  name?: string
  description?: string
  appType?: string
  headers?: EmailHeadersDTO
  metadata?: ContentMetadataDTO
  settings?: EmailSettingsResponseDTO
  status?: string
  state?: string
  virtualId?: string
  associatedStates?: Array<AssociatedStateDTO>
  appData?: EmailAppDataResponseDTO
  templateId?: string
  externalId?: string
  editorContext?: EditorContextDto
  scriptEngine?: string
}
