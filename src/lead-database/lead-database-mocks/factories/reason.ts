import { faker } from '@faker-js/faker'
import type { Reason } from '../../lead-database-definitions/models/reason'

export function makeReason(overrides: Partial<Reason> = {}): Reason {
  return {
    code: faker.string.numeric(4),
    message: faker.lorem.sentence(),
    ...overrides,
  }
}
