import { faker } from '@faker-js/faker'
import type { Error } from '../../lead-database-definitions/models/error'

export function makeError(overrides: Partial<Error> = {}): Error {
  return {
    code: faker.string.numeric(4),
    message: faker.lorem.sentence(),
    ...overrides,
  }
}
