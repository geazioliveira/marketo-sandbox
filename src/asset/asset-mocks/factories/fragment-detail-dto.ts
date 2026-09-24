import type { FragmentDetailDTO } from '../../asset-definitions/models/fragment-detail-dto'
import { makeDataDTO } from './data-dto'
import { makeFragmentContentDTO } from './fragment-content-dto'

export function makeFragmentDetailDTO(
  overrides: Partial<FragmentDetailDTO> = {},
): FragmentDetailDTO {
  return {
    ...makeFragmentContentDTO(),
    data: makeDataDTO(),
    ...overrides,
  }
}
