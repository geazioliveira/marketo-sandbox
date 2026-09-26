import { faker } from '@faker-js/faker'
import type { ProgramOperation } from '../../data-ingestion-definitions/models/program-operation'
import { makeProgramMember } from './program-member'

export function makeProgramOperation(
  overrides: Partial<ProgramOperation> = {},
): ProgramOperation {
  return {
    programId: faker.number.int({ min: 1, max: 99999 }),
    status: faker.lorem.word(),
    members: faker.helpers.multiple(() => makeProgramMember(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
