import { faker } from '@faker-js/faker'
import type { CloneSnippetRequest } from '../../asset-definitions/requests/clone-snippet-request'
import { makeFolder } from './folder'

export function makeCloneSnippetRequest(
  overrides: Partial<CloneSnippetRequest> = {},
): CloneSnippetRequest {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    folder: makeFolder(),
    description: faker.lorem.sentence(),
    ...overrides,
  }
}
