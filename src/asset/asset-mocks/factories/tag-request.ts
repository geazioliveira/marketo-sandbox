import { faker } from '@faker-js/faker'
import type { TagRequest } from '../../asset-definitions/requests/tag-request'

export function makeTagRequest(
  overrides: Partial<TagRequest> = {},
): TagRequest {
  return {
    tagType: faker.lorem.word(),
    tagValue: faker.lorem.word(),
    ...overrides,
  }
}
