import { faker } from '@faker-js/faker'
import type { ChangeLeadProgramStatusOutputData } from '../../lead-database-definitions/models/change-lead-program-status-output-data'
import { makeReason } from './reason'

export function makeChangeLeadProgramStatusOutputData(
  overrides: Partial<ChangeLeadProgramStatusOutputData> = {},
): ChangeLeadProgramStatusOutputData {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    reasons: faker.helpers.multiple(() => makeReason(), {
      count: { min: 1, max: 3 },
    }),
    status: faker.lorem.word(),
    ...overrides,
  }
}
