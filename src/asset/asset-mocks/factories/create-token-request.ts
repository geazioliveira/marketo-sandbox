import { faker } from '@faker-js/faker'
import type { CreateTokenRequest } from '../../asset-definitions/requests/create-token-request'

export function makeCreateTokenRequest(
  overrides: Partial<CreateTokenRequest> = {},
): CreateTokenRequest {
  return {
    folderType: faker.helpers.arrayElement(['Program', 'Folder'] as const),
    name: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.helpers.arrayElement([
      'date',
      'number',
      'rich text',
      'score',
      'sfdc campaign',
      'text',
    ] as const),
    value: faker.lorem.word(),
    ...overrides,
  }
}
