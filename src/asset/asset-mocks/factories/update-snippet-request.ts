import { faker } from '@faker-js/faker'
import type { UpdateSnippetRequest } from '../../asset-definitions/requests/update-snippet-request'

export function makeUpdateSnippetRequest(
  overrides: Partial<UpdateSnippetRequest> = {},
): UpdateSnippetRequest {
  return {
    description: faker.lorem.sentence(),
    isArchive: faker.lorem.word(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
