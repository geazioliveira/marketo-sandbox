import { faker } from '@faker-js/faker'
import type { EmailFilterResult } from '../../asset-definitions/models/email-filter-result'
import { makeEmailContentDTO } from './email-content-dto'
import { makePageDetailsDTO } from './page-details-dto'

export function makeEmailFilterResult(
  overrides: Partial<EmailFilterResult> = {},
): EmailFilterResult {
  return {
    ...makePageDetailsDTO(),
    items: faker.helpers.multiple(() => makeEmailContentDTO(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
