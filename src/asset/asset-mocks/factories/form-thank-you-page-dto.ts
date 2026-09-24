import { faker } from '@faker-js/faker'
import type { FormThankYouPageDTO } from '../../asset-definitions/models/form-thank-you-page-dto'

export function makeFormThankYouPageDTO(
  overrides: Partial<FormThankYouPageDTO> = {},
): FormThankYouPageDTO {
  return {
    default: faker.datatype.boolean(),
    followupType: faker.lorem.word(),
    followupValue: {},
    operator: faker.lorem.word(),
    subjectField: faker.lorem.words({ min: 2, max: 5 }),
    values: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
