import { faker } from '@faker-js/faker'
import type { DeleteTokenRequest } from '../../asset-definitions/requests/delete-token-request'

export function makeDeleteTokenRequest(
  overrides: Partial<DeleteTokenRequest> = {},
): DeleteTokenRequest {
  return {
    folderType: faker.helpers.arrayElement(['Program', 'Folder'] as const),
    name: faker.lorem.words({ min: 2, max: 3 }),
    type: faker.lorem.word(),
    ...overrides,
  }
}
