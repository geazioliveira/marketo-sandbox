import { faker } from '@faker-js/faker'
import type { ContentMetadataDTO } from '../../asset-definitions/models/content-metadata-dto'

export function makeContentMetadataDTO(
  overrides: Partial<ContentMetadataDTO> = {},
): ContentMetadataDTO {
  return {
    createdBy: faker.lorem.word(),
    createdAt: faker.date.recent().toISOString(),
    createdById: faker.lorem.word(),
    createdByAepId: faker.lorem.word(),
    modifiedBy: faker.lorem.word(),
    modifiedAt: faker.lorem.word(),
    modifiedById: faker.lorem.word(),
    modifiedByAepId: faker.lorem.word(),
    ...overrides,
  }
}
