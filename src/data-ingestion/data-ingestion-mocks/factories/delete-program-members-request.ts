import { faker } from '@faker-js/faker'
import type { DeleteProgramMembersRequest } from '../../data-ingestion-definitions/requests/delete-program-members-request'
import { makeDeleteProgramOperation } from './delete-program-operation'

export function makeDeleteProgramMembersRequest(
  overrides: Partial<DeleteProgramMembersRequest> = {},
): DeleteProgramMembersRequest {
  return {
    programs: faker.helpers.multiple(() => makeDeleteProgramOperation(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
