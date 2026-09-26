import { faker } from '@faker-js/faker'
import type { ProgramMembership } from '../../lead-database-definitions/models/program-membership'

export function makeProgramMembership(
  overrides: Partial<ProgramMembership> = {},
): ProgramMembership {
  return {
    acquiredBy: faker.datatype.boolean(),
    isExhausted: faker.datatype.boolean(),
    membershipDate: faker.date.recent().toISOString(),
    nurtureCadence: faker.lorem.word(),
    progressionStatus: faker.lorem.word(),
    reachedSuccess: faker.datatype.boolean(),
    stream: faker.lorem.word(),
    ...overrides,
  }
}
