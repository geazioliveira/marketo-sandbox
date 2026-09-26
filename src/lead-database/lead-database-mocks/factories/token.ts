import { faker } from '@faker-js/faker'
import type { Token } from '../../lead-database-definitions/models/token'

export function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    name: faker.lorem.words({ min: 2, max: 3 }),
    value: faker.lorem.word(),
    ...overrides,
  }
}
