import { faker } from '@faker-js/faker'
import type { SmartListResponseWithRules } from '../../asset-definitions/models/smart-list-response-with-rules'
import { makeFolder } from './folder'
import { makeSmartListRules } from './smart-list-rules'

export function makeSmartListResponseWithRules(
  overrides: Partial<SmartListResponseWithRules> = {},
): SmartListResponseWithRules {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    description: faker.lorem.sentence(),
    createdAt: faker.date.recent().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    url: faker.internet.url(),
    folder: makeFolder(),
    workspace: 'Default',
    rules: makeSmartListRules(),
    ...overrides,
  }
}
