import { faker } from '@faker-js/faker'
import type { TagResponseGetAll } from '../../asset-definitions/models/tag-response-get-all'

export function makeTagResponseGetAll(
  overrides: Partial<TagResponseGetAll> = {},
): TagResponseGetAll {
  return {
    applicableProgramTypes: faker.lorem.word(),
    required: faker.datatype.boolean(),
    tagType: faker.lorem.word(),
    ...overrides,
  }
}
