import { faker } from '@faker-js/faker'
import type { ProgramMemberDelete } from '../../lead-database-definitions/models/program-member-delete'

export function makeProgramMemberDelete(
  overrides: Partial<ProgramMemberDelete> = {},
): ProgramMemberDelete {
  return {
    leadId: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
