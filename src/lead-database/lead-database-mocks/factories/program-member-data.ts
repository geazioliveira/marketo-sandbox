import { faker } from '@faker-js/faker'
import type { ProgramMemberData } from '../../lead-database-definitions/models/program-member-data'

export function makeProgramMemberData(
  overrides: Partial<ProgramMemberData> = {},
): ProgramMemberData {
  return {
    leadId: faker.number.int({ min: 1, max: 99999 }),
    '{fieldApiName}': faker.lorem.word(),
    '{fieldApiName2}': faker.lorem.word(),
    ...overrides,
  }
}
