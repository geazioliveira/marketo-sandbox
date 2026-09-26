import { faker } from '@faker-js/faker'
import type { ProgramMember } from '../../data-ingestion-definitions/models/program-member'

export function makeProgramMember(
  overrides: Partial<ProgramMember> = {},
): ProgramMember {
  return {
    leadId: faker.number.int({ min: 1, max: 99999 }),
    ...overrides,
  }
}
