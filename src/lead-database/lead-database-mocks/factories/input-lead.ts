import { faker } from '@faker-js/faker'
import type { InputLead } from '../../lead-database-definitions/models/input-lead'

export function makeInputLead(overrides: Partial<InputLead> = {}): InputLead {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
