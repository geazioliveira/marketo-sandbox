import type { AppDataDTO } from './app-data-dto'

export interface UsedByItemDTO {
  id?: string
  name?: string
  appData?: AppDataDTO
  channel?: string
  contentType?: string
  externalId?: string
}
