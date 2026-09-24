import { faker } from '@faker-js/faker'
import type { UsedByItemDTO } from '../../asset-definitions/models/used-by-item-dto'
import { makeAppDataDTO } from './app-data-dto'

export function makeUsedByItemDTO(
  overrides: Partial<UsedByItemDTO> = {},
): UsedByItemDTO {
  return {
    id: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    appData: makeAppDataDTO(),
    channel: faker.lorem.word(),
    contentType: faker.lorem.paragraph(),
    externalId: faker.lorem.word(),
    ...overrides,
  }
}
