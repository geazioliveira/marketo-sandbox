import { faker } from '@faker-js/faker'
import type { SmartListResponse } from '../../asset-definitions/responses/smart-list-response'
import { makeFolder } from './folder'

export function makeSmartListResponse(
  overrides: Partial<SmartListResponse> = {},
): SmartListResponse {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    createdAt: faker.date.recent().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    folder: makeFolder(),
    workspace: 'Default',
    ...overrides,
  }
}
