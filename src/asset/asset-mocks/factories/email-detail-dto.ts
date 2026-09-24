import type { EmailDetailDTO } from '../../asset-definitions/models/email-detail-dto'
import { makeDataDTO } from './data-dto'
import { makeEmailContentDTO } from './email-content-dto'

export function makeEmailDetailDTO(
  overrides: Partial<EmailDetailDTO> = {},
): EmailDetailDTO {
  return {
    ...makeEmailContentDTO(),
    data: makeDataDTO(),
    ...overrides,
  }
}
