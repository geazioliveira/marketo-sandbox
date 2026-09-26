import { faker } from '@faker-js/faker'
import type { Attribute } from '../../lead-database-definitions/models/attribute'

export function makeAttribute(overrides: Partial<Attribute> = {}): Attribute {
  return {
    apiName: faker.lorem.words({ min: 2, max: 3 }),
    name: faker.lorem.words({ min: 2, max: 3 }),
    value: {},
    ...overrides,
  }
}
