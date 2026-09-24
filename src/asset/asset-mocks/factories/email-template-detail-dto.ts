import type { EmailTemplateDetailDTO } from '../../asset-definitions/models/email-template-detail-dto'
import { makeDataDTO } from './data-dto'
import { makeEmailTemplateContentDTO } from './email-template-content-dto'

export function makeEmailTemplateDetailDTO(
  overrides: Partial<EmailTemplateDetailDTO> = {},
): EmailTemplateDetailDTO {
  return {
    ...makeEmailTemplateContentDTO(),
    data: makeDataDTO(),
    ...overrides,
  }
}
