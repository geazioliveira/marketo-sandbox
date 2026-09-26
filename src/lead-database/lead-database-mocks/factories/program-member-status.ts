import { faker } from '@faker-js/faker'
import type { ProgramMemberStatus } from '../../lead-database-definitions/models/program-member-status'

export function makeProgramMemberStatus(
  overrides: Partial<ProgramMemberStatus> = {},
): ProgramMemberStatus {
  return {
    leadId: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
