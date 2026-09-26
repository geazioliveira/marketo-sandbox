import { faker } from '@faker-js/faker'
import type { ChangeLeadProgramStatusRequest } from '../../lead-database-definitions/requests/change-lead-program-status-request'
import { makeLeadLookupInputData } from './lead-lookup-input-data'

export function makeChangeLeadProgramStatusRequest(
  overrides: Partial<ChangeLeadProgramStatusRequest> = {},
): ChangeLeadProgramStatusRequest {
  return {
    input: faker.helpers.multiple(() => makeLeadLookupInputData(), {
      count: { min: 1, max: 3 },
    }),
    status: faker.lorem.word(),
    ...overrides,
  }
}
