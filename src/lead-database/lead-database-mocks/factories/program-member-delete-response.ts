import { faker } from '@faker-js/faker'
import type { ProgramMemberDeleteResponse } from '../../lead-database-definitions/responses/program-member-delete-response'
import { makeReason } from './reason'

export function makeProgramMemberDeleteResponse(
  overrides: Partial<ProgramMemberDeleteResponse> = {},
): ProgramMemberDeleteResponse {
  return {
    status: faker.helpers.arrayElement(['deleted', 'skipped'] as const),
    reasons: faker.helpers.multiple(() => makeReason(), {
      count: { min: 1, max: 3 },
    }),
    leadId: faker.number.int({ min: 1, max: 99999 }),
    seq: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
