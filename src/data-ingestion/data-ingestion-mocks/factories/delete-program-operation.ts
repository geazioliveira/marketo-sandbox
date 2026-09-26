import { faker } from '@faker-js/faker'
import type { DeleteProgramOperation } from '../../data-ingestion-definitions/models/delete-program-operation'
import { makeProgramMember } from './program-member'

export function makeDeleteProgramOperation(
  overrides: Partial<DeleteProgramOperation> = {},
): DeleteProgramOperation {
  return {
    programId: faker.number.int({ min: 1, max: 99999 }),
    members: faker.helpers.multiple(() => makeProgramMember(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
