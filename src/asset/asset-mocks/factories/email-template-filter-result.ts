import { faker } from '@faker-js/faker'
import type { EmailTemplateFilterResult } from '../../asset-definitions/models/email-template-filter-result'
import { makeEmailTemplateContentDTO } from './email-template-content-dto'
import { makePageDetailsDTO } from './page-details-dto'

export function makeEmailTemplateFilterResult(
  overrides: Partial<EmailTemplateFilterResult> = {},
): EmailTemplateFilterResult {
  return {
    ...makePageDetailsDTO(),
    items: faker.helpers.multiple(() => makeEmailTemplateContentDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
