import { faker } from '@faker-js/faker'
import type { ProgramMember } from '../../lead-database-definitions/models/program-member'

export function makeProgramMember(
  overrides: Partial<ProgramMember> = {},
): ProgramMember {
  return {
    seq: faker.number.int({ min: 1, max: 1000 }),
    leadId: faker.number.int({ min: 1, max: 99999 }),
    reachedSuccess: faker.datatype.boolean(),
    programId: faker.number.int({ min: 1, max: 99999 }),
    acquiredBy: faker.datatype.boolean(),
    membershipDate: faker.date.recent().toISOString(),
    ...overrides,
  }
}
