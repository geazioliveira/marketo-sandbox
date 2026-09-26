import { faker } from '@faker-js/faker'
import type { SyncProgramMemberDataRequest } from '../../lead-database-definitions/requests/sync-program-member-data-request'
import { makeProgramMemberData } from './program-member-data'

export function makeSyncProgramMemberDataRequest(
  overrides: Partial<SyncProgramMemberDataRequest> = {},
): SyncProgramMemberDataRequest {
  return {
    input: faker.helpers.multiple(() => makeProgramMemberData(), {
      count: { min: 1, max: 3 },
    }),
    ...overrides,
  }
}
