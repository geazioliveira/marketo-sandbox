import { faker } from '@faker-js/faker'
import type { CloneEmailTemplateRequest } from '../../asset-definitions/requests/clone-email-template-request'
import { makeFolder } from './folder'

export function makeCloneEmailTemplateRequest(
  overrides: Partial<CloneEmailTemplateRequest> = {},
): CloneEmailTemplateRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
