import type { DataDTO } from '../../asset-definitions/models/data-dto'
import { makeHtmlDataDTO } from './html-data-dto'
import { makeTextDataDTO } from './text-data-dto'

export function makeDataDTO(overrides: Partial<DataDTO> = {}): DataDTO {
  return {
    html: makeHtmlDataDTO(),
    text: makeTextDataDTO(),
    ...overrides,
  }
}
