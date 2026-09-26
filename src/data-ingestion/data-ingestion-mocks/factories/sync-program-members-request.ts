import { faker } from '@faker-js/faker'
import type { SyncProgramMembersRequest } from '../../data-ingestion-definitions/requests/sync-program-members-request'
import { makeProgramOperation } from './program-operation'

export function makeSyncProgramMembersRequest(
  overrides: Partial<SyncProgramMembersRequest> = {},
): SyncProgramMembersRequest {
  return {
    programs: faker.helpers.multiple(() => makeProgramOperation(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
