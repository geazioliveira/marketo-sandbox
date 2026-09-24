import { faker } from '@faker-js/faker'
import type { EmailHeaderField } from '../../asset-definitions/models/email-header-field'

export function makeEmailHeaderField(
  overrides: Partial<EmailHeaderField> = {},
): EmailHeaderField {
  return {
    type: faker.lorem.word(),
    value: faker.lorem.word(),
    ...overrides,
  }
}
