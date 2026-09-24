import { faker } from '@faker-js/faker'
import type { UpdateEmailTemplateContentRequest } from '../../asset-definitions/requests/update-email-template-content-request'

export function makeUpdateEmailTemplateContentRequest(
  overrides: Partial<UpdateEmailTemplateContentRequest> = {},
): UpdateEmailTemplateContentRequest {
  return {
    content: faker.lorem.paragraph(),
    ...overrides,
  }
}
