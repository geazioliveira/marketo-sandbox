import { faker } from '@faker-js/faker'
import type { FormVisibilityRuleDTO } from '../../asset-definitions/models/form-visibility-rule-dto'
import { makePickListDTO } from './pick-list-dto'

export function makeFormVisibilityRuleDTO(
  overrides: Partial<FormVisibilityRuleDTO> = {},
): FormVisibilityRuleDTO {
  return {
    altLabel: faker.lorem.words({ min: 2, max: 5 }),
    operator: faker.lorem.word(),
    picklistFilterValues: faker.helpers.multiple(() => makePickListDTO(), {
      count: { min: 1, max: 3 },
    }),
    subjectField: faker.lorem.words({ min: 2, max: 5 }),
    values: faker.helpers.multiple(() => faker.lorem.word(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
