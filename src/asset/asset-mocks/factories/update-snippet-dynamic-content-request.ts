import { faker } from '@faker-js/faker'
import type { UpdateSnippetDynamicContentRequest } from '../../asset-definitions/requests/update-snippet-dynamic-content-request'

export function makeUpdateSnippetDynamicContentRequest(
  overrides: Partial<UpdateSnippetDynamicContentRequest> = {},
): UpdateSnippetDynamicContentRequest {
  return {
    type: faker.helpers.arrayElement([
      "Typeofcontent.Either'HTML'or'Text'",
    ] as const),
    value: faker.lorem.word(),
    ...overrides,
  }
}
