import { faker } from '@faker-js/faker'
import type { SnippetContentResponse } from '../../asset-definitions/responses/snippet-content-response'

export function makeSnippetContentResponse(
  overrides: Partial<SnippetContentResponse> = {},
): SnippetContentResponse {
  return {
    content: faker.lorem.paragraph(),
    type: faker.lorem.word(),
    ...overrides,
  }
}
