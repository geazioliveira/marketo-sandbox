import { faker } from '@faker-js/faker'
import type { CreateSnippetRequest } from '../../asset-definitions/requests/create-snippet-request'
import { makeFolder } from './folder'

export function makeCreateSnippetRequest(
  overrides: Partial<CreateSnippetRequest> = {},
): CreateSnippetRequest {
  return {
    description: faker.lorem.sentence(),
    folder: makeFolder(),
    name: faker.lorem.words({ min: 2, max: 3 }),
    ...overrides,
  }
}
