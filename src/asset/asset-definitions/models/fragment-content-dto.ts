import type { AppDataDTO } from './app-data-dto'
import type { AssociatedStateDTO } from './associated-state-dto'
import type { ContentMetadataDTO } from './content-metadata-dto'
import type { EditorContextDto } from './editor-context-dto'
import type { FragmentSettingsDTO } from './fragment-settings-dto'
import type { ThumbnailDTO } from './thumbnail-dto'

export interface FragmentContentDTO {
  id?: string
  name?: string
  description?: string
  appType?: string
  metadata?: ContentMetadataDTO
  settings?: FragmentSettingsDTO
  thumbnail?: ThumbnailDTO
  status?: string
  state?: string
  virtualId?: string
  associatedStates?: Array<AssociatedStateDTO>
  appData?: AppDataDTO
  externalId?: string
  editorContext?: EditorContextDto
  scriptEngine?: string
  themeId?: string
}
