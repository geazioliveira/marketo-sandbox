import { faker } from '@faker-js/faker'
import type { SnippetResponse } from '../../asset-definitions/responses/snippet-response'
import { makeSnippetFolder } from './snippet-folder'

export function makeSnippetResponse(
  overrides: Partial<SnippetResponse> = {},
): SnippetResponse {
  return {
    createdAt: faker.date.recent().toISOString(),
    description: faker.lorem.sentence(),
    folder: makeSnippetFolder(),
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    status: faker.helpers.arrayElement(['approved', 'draft'] as const),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    workspace: 'Default',
    ...overrides,
  }
}
