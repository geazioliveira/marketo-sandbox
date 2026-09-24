import { faker } from '@faker-js/faker'
import type { PickListDTO } from '../../asset-definitions/models/pick-list-dto'

export function makePickListDTO(
  overrides: Partial<PickListDTO> = {},
): PickListDTO {
  return {
    isDefault: faker.datatype.boolean(),
    label: faker.lorem.words({ min: 2, max: 5 }),
    selected: faker.datatype.boolean(),
    value: faker.lorem.word(),
    ...overrides,
  }
}
