import { faker } from '@faker-js/faker'
import type { Form } from '../../lead-database-definitions/models/form'
import { makeLeadFormFields } from './lead-form-fields'
import { makeVisitorData } from './visitor-data'

export function makeForm(overrides: Partial<Form> = {}): Form {
  return {
    leadFormFields: makeLeadFormFields(),
    visitorData: makeVisitorData(),
    cookie: faker.lorem.word(),
    ...overrides,
  }
}
