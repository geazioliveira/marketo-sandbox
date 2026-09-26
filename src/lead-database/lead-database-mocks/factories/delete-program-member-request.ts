import { faker } from '@faker-js/faker'
import type { DeleteProgramMemberRequest } from '../../lead-database-definitions/requests/delete-program-member-request'
import { makeProgramMemberDelete } from './program-member-delete'

export function makeDeleteProgramMemberRequest(
  overrides: Partial<DeleteProgramMemberRequest> = {},
): DeleteProgramMemberRequest {
  return {
    input: faker.helpers.multiple(() => makeProgramMemberDelete(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
