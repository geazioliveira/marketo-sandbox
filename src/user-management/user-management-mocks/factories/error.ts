import { faker } from '@faker-js/faker'
import type { Error } from '../../user-management-definitions/models/error'

export function makeError(overrides: Partial<Error> = {}): Error {
  return {
    code: faker.number.int({ min: 1, max: 1000 }),
    message: faker.lorem.sentence(),
    ...overrides,
  }
}
