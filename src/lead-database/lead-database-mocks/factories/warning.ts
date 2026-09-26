import { faker } from '@faker-js/faker'
import type { Warning } from '../../lead-database-definitions/models/warning'

export function makeWarning(overrides: Partial<Warning> = {}): Warning {
  return {
    code: faker.number.int({ min: 1, max: 1000 }),
    message: faker.lorem.sentence(),
    ...overrides,
  }
}
