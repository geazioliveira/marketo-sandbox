import { faker } from '@faker-js/faker'
import type { ProgramMemberDataResponse } from '../../lead-database-definitions/responses/program-member-data-response'
import { makeReason } from './reason'

export function makeProgramMemberDataResponse(
  overrides: Partial<ProgramMemberDataResponse> = {},
): ProgramMemberDataResponse {
  return {
    status: faker.helpers.arrayElement([
      'created',
      'updated',
      'skipped',
    ] as const),
    reasons: faker.helpers.multiple(() => makeReason(), {
      count: { min: 1, max: 3 },
    }),
    leadId: faker.number.int({ min: 1, max: 99999 }),
    seq: faker.number.int({ min: 1, max: 1000 }),
    ...overrides,
  }
}
