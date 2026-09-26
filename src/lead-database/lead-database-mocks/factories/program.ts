import { faker } from '@faker-js/faker'
import type { Program } from '../../lead-database-definitions/models/program'

export function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    acquiredBy: faker.datatype.boolean(),
    isExhausted: faker.datatype.boolean(),
    membershipDate: faker.date.recent().toISOString(),
    nurtureCadence: faker.lorem.word(),
    progressionStatus: faker.lorem.word(),
    reachedSuccess: faker.datatype.boolean(),
    stream: faker.lorem.word(),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  }
}
