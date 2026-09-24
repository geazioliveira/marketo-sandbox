import { faker } from '@faker-js/faker'
import type { FormKnownVisitorDTO } from '../../asset-definitions/models/form-known-visitor-dto'

export function makeFormKnownVisitorDTO(
  overrides: Partial<FormKnownVisitorDTO> = {},
): FormKnownVisitorDTO {
  return {
    template: faker.lorem.word(),
    type: faker.lorem.word(),
    ...overrides,
  }
}
