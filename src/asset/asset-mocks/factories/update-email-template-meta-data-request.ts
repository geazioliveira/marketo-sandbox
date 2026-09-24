import { faker } from '@faker-js/faker'
import type { UpdateEmailTemplateMetaDataRequest } from '../../asset-definitions/requests/update-email-template-meta-data-request'

export function makeUpdateEmailTemplateMetaDataRequest(
  overrides: Partial<UpdateEmailTemplateMetaDataRequest> = {},
): UpdateEmailTemplateMetaDataRequest {
  return {
    description: faker.lorem.sentence(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
