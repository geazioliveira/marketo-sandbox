import { faker } from '@faker-js/faker'
import type { LeadFormFields } from '../../lead-database-definitions/models/lead-form-fields'

export function makeLeadFormFields(
  overrides: Partial<LeadFormFields> = {},
): LeadFormFields {
  return {
    email: faker.internet.email(),
    ...overrides,
  }
}
