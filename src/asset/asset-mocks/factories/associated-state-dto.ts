import { faker } from '@faker-js/faker'
import type { AssociatedStateDTO } from '../../asset-definitions/models/associated-state-dto'

export function makeAssociatedStateDTO(
  overrides: Partial<AssociatedStateDTO> = {},
): AssociatedStateDTO {
  return {
    contentId: faker.lorem.paragraph(),
    externalId: faker.lorem.word(),
    state: faker.lorem.word(),
    ...overrides,
  }
}
