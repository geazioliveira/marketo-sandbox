import { faker } from '@faker-js/faker'
import type { EmailCCFields } from '../../asset-definitions/models/email-cc-fields'

export function makeEmailCCFields(
  overrides: Partial<EmailCCFields> = {},
): EmailCCFields {
  return {
    attributeId: faker.lorem.word(),
    objectName: faker.lorem.words({ min: 2, max: 3 }),
    displayName: faker.lorem.words({ min: 2, max: 3 }),
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
