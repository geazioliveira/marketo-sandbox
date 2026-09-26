import { faker } from '@faker-js/faker'
import type { SubmitFormRequest } from '../../lead-database-definitions/requests/submit-form-request'
import { makeForm } from './form'

export function makeSubmitFormRequest(
  overrides: Partial<SubmitFormRequest> = {},
): SubmitFormRequest {
  return {
    input: faker.helpers.multiple(() => makeForm(), {
      count: { min: 1, max: 3 },
    }),
    formId: faker.number.int({ min: 1, max: 99999 }),
    programId: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
