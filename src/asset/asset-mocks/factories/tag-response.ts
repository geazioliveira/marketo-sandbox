import { faker } from '@faker-js/faker'
import type { TagResponse } from '../../asset-definitions/responses/tag-response'

export function makeTagResponse(
  overrides: Partial<TagResponse> = {},
): TagResponse {
  return {
    allowableValues: faker.lorem.word(),
    applicableProgramTypes: faker.lorem.word(),
    required: faker.datatype.boolean(),
    tagType: faker.lorem.word(),
    ...overrides,
  }
}
